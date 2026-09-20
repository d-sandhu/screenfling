use crate::{app::Message, desktop};
use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use futures_lite::{StreamExt, future::{block_on, race}};
use std::{thread::JoinHandle, time::Duration};

pub struct PortalShortcut { stop: async_channel::Sender<()>, worker: Option<JoinHandle<()>> }
impl PortalShortcut {
    pub fn start() -> Self {
        let (stop, receiver) = async_channel::bounded(1);
        let worker = std::thread::Builder::new().name("screenfling-shortcut".into()).spawn(move || {
            let result = block_on(run(&receiver));
            if result.is_err() {
                desktop::post(Message::ShortcutStatus("This desktop did not provide a global shortcut. Use Capture, the tray, or bind screenfling --capture in your desktop settings.".into()));
            }
        }).ok();
        if worker.is_none() { desktop::post(Message::ShortcutStatus("Could not start the shortcut portal. The Capture button remains available.".into())); }
        Self { stop, worker }
    }
}
impl Drop for PortalShortcut {
    fn drop(&mut self) {
        let _ = self.stop.try_send(());
        if self.worker.as_ref().is_some_and(JoinHandle::is_finished) { if let Some(worker) = self.worker.take() { let _ = worker.join(); } }
    }
}
async fn cancellable<T>(future: impl std::future::Future<Output = ashpd::Result<T>>, stop: &async_channel::Receiver<()>) -> Result<T, String> {
    race(async { future.await.map_err(|_| "Shortcut portal unavailable.".into()) }, async { let _ = stop.recv().await; Err("Shortcut request stopped.".into()) }).await
}
async fn run(stop: &async_channel::Receiver<()>) -> Result<(), String> {
    let proxy = cancellable(GlobalShortcuts::new(), stop).await?;
    let session = cancellable(proxy.create_session(Default::default()), stop).await?;
    let result = async {
        // Session serializes as its D-Bus object path. Match it as well as the shortcut id.
        let handle = serde_json::to_value(&session).map_err(|_| "Could not identify the shortcut session.")?;
        let handle = handle.as_str().ok_or("Invalid shortcut session identifier.")?;
        let keys = [NewShortcut::new("capture", "Capture a region with ScreenFling").preferred_trigger("CTRL+SHIFT+9")];
        let mut activated = Box::pin(cancellable(proxy.receive_activated(), stop).await?);
        let binding = cancellable(proxy.bind_shortcuts(&session, &keys, None, Default::default()), stop).await?.response().map_err(|_| "Shortcut permission was not granted.")?;
        let key = binding.shortcuts().iter().find(|key| key.id() == "capture").ok_or("The desktop did not bind Capture.")?;
        desktop::post(Message::ShortcutStatus(format!("Capture shortcut: {}", key.trigger_description())));
        let mut closed = Box::pin(session.receive_closed().await.map_err(|_| "The shortcut session is unavailable.")?);
        race(async {
            loop {
                let event = activated.next().await.ok_or("The shortcut portal disconnected.")?;
                if event.shortcut_id() == "capture" && event.session_handle().as_str() == handle {
                    desktop::post(Message::Shortcut(u32::MAX));
                }
            }
        }, race(async { let _ = stop.recv().await; Ok(()) }, async { let _ = closed.next().await; Err("The shortcut session was closed.".into()) })).await
    }.await;
    race(async { let _ = session.close().await; }, async { async_io::Timer::after(Duration::from_secs(2)).await; }).await;
    result
}
