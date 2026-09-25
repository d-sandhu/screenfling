//! Detect foreground coding agents from process metadata, never window titles.
//! Until a terminal exposes an exact pane/TTY mapping, every interactive TTY
//! belonging to its process must be running a known agent. Mixed shell/agent
//! windows are deliberately omitted instead of guessing which pane has focus.
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
struct Process {
    pid: u32,
    parent: u32,
    group: u32,
    foreground: u32,
    tty: Option<u64>,
    started: u64,
    name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Guard {
    host: u32,
    host_started: u64,
    sessions: Vec<(u64, u32, u32, u64)>,
    pub label: String,
}
impl Guard {
    pub fn current(&self) -> bool {
        detect(self.host).as_ref() == Some(self)
    }
}

pub fn detect(host: u32) -> Option<Guard> {
    classify(host, &snapshot()?)
}

/// One metadata snapshot per discovery, without command lines or environments.
pub struct Inventory(Vec<Process>);
impl Inventory {
    pub fn read() -> Option<Self> {
        snapshot().map(Self)
    }
    pub fn detect(&self, host: u32) -> Option<Guard> {
        classify(host, &self.0)
    }
}

fn agent(name: &str) -> Option<&'static str> {
    match name {
        "claude" => Some("Claude Code"),
        "codex" => Some("Codex"),
        "opencode" => Some("OpenCode"),
        _ => None,
    }
}
fn classify(host: u32, processes: &[Process]) -> Option<Guard> {
    let by_id: BTreeMap<_, _> = processes.iter().map(|p| (p.pid, p)).collect();
    let host_process = by_id.get(&host)?;
    if !matches!(
        host_process.name.to_lowercase().as_str(),
        "ghostty"
            | "terminal"
            | "iterm2"
            | "wezterm-gui"
            | "kitty"
            | "alacritty"
            | "xterm"
            | "xfce4-terminal"
            | "gnome-terminal-server"
            | "gnome-terminal-"
            | "konsole"
    ) {
        return None;
    }
    let descendants: Vec<_> = processes
        .iter()
        .filter(|p| {
            let mut parent = p.parent;
            for _ in 0..64 {
                if parent == host {
                    return true;
                }
                let Some(next) = by_id.get(&parent) else {
                    return false;
                };
                if next.parent == parent {
                    return false;
                }
                parent = next.parent;
            }
            false
        })
        .collect();
    let ttys: BTreeSet<_> = descendants.iter().filter_map(|p| p.tty).collect();
    if ttys.is_empty() {
        return None;
    }
    let mut sessions = Vec::new();
    let mut labels = BTreeSet::new();
    for tty in ttys {
        let foreground: BTreeSet<_> = descendants
            .iter()
            .filter(|p| p.tty == Some(tty))
            .map(|p| p.foreground)
            .collect();
        if foreground.len() != 1 {
            return None;
        }
        let foreground = *foreground.first()?;
        if foreground == 0 {
            return None;
        }
        let candidates: Vec<_> = descendants
            .iter()
            .filter(|p| p.tty == Some(tty) && p.group == foreground && agent(&p.name).is_some())
            .collect();
        // Multiple agent processes sharing a foreground group are ambiguous too.
        if candidates.len() != 1 {
            return None;
        }
        let p = candidates[0];
        labels.insert(agent(&p.name)?);
        sessions.push((tty, foreground, p.pid, p.started));
    }
    Some(Guard {
        host,
        host_started: host_process.started,
        sessions,
        label: labels.into_iter().collect::<Vec<_>>().join(" / "),
    })
}

#[cfg(target_os = "macos")]
fn snapshot() -> Option<Vec<Process>> {
    let mut pids = vec![0i32; 32768];
    let count =
        unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), (pids.len() * 4) as i32) };
    if count <= 0 || count as usize >= pids.len() {
        return None;
    }
    let mut result = Vec::new();
    for pid in pids.into_iter().take(count as usize) {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        if unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        } != size
        {
            continue;
        }
        if info.pbi_uid != unsafe { libc::geteuid() } {
            continue;
        }
        let bytes: Vec<_> = info
            .pbi_comm
            .iter()
            .take_while(|v| **v != 0)
            .map(|v| *v as u8)
            .collect();
        result.push(Process {
            pid: info.pbi_pid,
            parent: info.pbi_ppid,
            group: info.pbi_pgid,
            foreground: info.e_tpgid,
            tty: (info.e_tdev != u32::MAX).then_some(info.e_tdev as u64),
            started: info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
            name: String::from_utf8_lossy(&bytes).into_owned(),
        });
    }
    Some(result)
}

#[cfg(target_os = "linux")]
fn snapshot() -> Option<Vec<Process>> {
    use std::os::unix::fs::MetadataExt;
    let mut result = Vec::new();
    for (index, entry) in std::fs::read_dir("/proc").ok()?.enumerate() {
        if index >= 32768 {
            return None;
        }
        let Ok(entry) = entry else {
            continue;
        };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.uid() != unsafe { libc::geteuid() } {
            continue;
        }
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some(p) = parse_stat(pid, &stat) else {
            continue;
        };
        result.push(p);
    }
    Some(result)
}
#[cfg(target_os = "linux")]
fn parse_stat(pid: u32, stat: &str) -> Option<Process> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let fields: Vec<_> = stat.get(close + 1..)?.split_whitespace().collect();
    let tty: i64 = fields.get(4)?.parse().ok()?;
    Some(Process {
        pid,
        name: stat.get(open + 1..close)?.to_owned(),
        parent: fields.get(1)?.parse().ok()?,
        group: fields.get(2)?.parse().ok()?,
        foreground: fields.get(5)?.parse().unwrap_or(0),
        tty: (tty != 0).then_some(tty as u64),
        started: fields.get(19)?.parse().ok()?,
    })
}

// Windows Terminal/ConPTY does not provide the Unix foreground-TTY identity.
// Do not equate an agent somewhere in a process tree with the selected tab.
#[cfg(target_os = "windows")]
fn snapshot() -> Option<Vec<Process>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(
        pid: u32,
        parent: u32,
        tty: Option<u64>,
        group: u32,
        foreground: u32,
        name: &str,
    ) -> Process {
        Process {
            pid,
            parent,
            tty,
            group,
            foreground,
            name: name.into(),
            started: 10,
        }
    }
    #[test]
    fn foreground_agents_only_and_every_terminal_session_must_match() {
        let mut ps = vec![
            p(1, 0, None, 1, 0, "ghostty"),
            p(2, 1, Some(1), 2, 3, "zsh"),
            p(3, 2, Some(1), 3, 3, "claude"),
        ];
        let original = classify(1, &ps).unwrap();
        assert_eq!(original.label, "Claude Code");
        // Headless workers are not interactive destinations.
        ps.push(p(4, 3, None, 4, 0, "codex"));
        assert_eq!(classify(1, &ps), Some(original.clone()));
        // A second, non-agent tab makes window-level routing ambiguous.
        ps.push(p(5, 1, Some(2), 5, 5, "zsh"));
        assert!(classify(1, &ps).is_none());
        ps[4].foreground = 6;
        ps.push(p(6, 5, Some(2), 6, 6, "codex"));
        assert_eq!(classify(1, &ps).unwrap().label, "Claude Code / Codex");
        // Background agents, reused PIDs, and mere names in a title do not qualify.
        ps[2].group = 10;
        assert!(classify(1, &ps).is_none());
        ps.truncate(3);
        ps[2].group = 3;
        ps[2].started += 1;
        assert_ne!(classify(1, &ps), Some(original));
        ps[2].name = "bash claude".into();
        assert!(classify(1, &ps).is_none());
    }

    #[test]
    fn wrapper_group_and_reused_terminal_identity() {
        let mut ps = vec![
            p(1, 0, None, 1, 0, "Terminal"),
            p(2, 1, Some(1), 2, 3, "zsh"),
            p(3, 2, Some(1), 3, 3, "node"),
            p(4, 3, Some(1), 3, 3, "codex"),
        ];
        let original = classify(1, &ps).unwrap();
        assert_eq!(original.label, "Codex");
        ps[0].started += 1;
        assert_ne!(classify(1, &ps), Some(original));
        ps[0].name = "editor".into();
        assert!(classify(1, &ps).is_none());
        ps[0].name = "Terminal".into();
        // A foreground-group change observed midway through the snapshot.
        ps[1].foreground = 2;
        assert!(classify(1, &ps).is_none());
        ps[1].foreground = 3;
        ps.push(p(5, 3, Some(1), 3, 3, "opencode"));
        assert!(classify(1, &ps).is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn proc_stat_preserves_tty_group_and_start_identity() {
        let p = parse_stat(
            42,
            "42 (name with ) space) S 7 13 7 34816 13 0 0 0 0 0 0 0 0 0 20 0 1 0 123456 0",
        )
        .unwrap();
        assert_eq!(
            (p.parent, p.group, p.foreground, p.tty, p.started),
            (7, 13, 13, Some(34816), 123456)
        );
        assert_eq!(p.name, "name with ) space");
        assert!(parse_stat(1, "1 (truncated) S").is_none());
    }
}
