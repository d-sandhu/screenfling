//! Windows file identity and access-control checks. Broad writable ACLs fail closed.
use screenfling::model::Result;
use sha2::{Digest, Sha256};
use std::{ffi::c_void, mem::size_of, os::windows::ffi::OsStrExt, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE, LocalFree},
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

// ACE_HEADER::AceType values from winnt.h. Avoid enabling a large unrelated API
// module just for these three ABI constants.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const SYSTEM_AUDIT_ACE_TYPE: u8 = 2;

struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}
fn sid_text(sid: PSID) -> Result<String> {
    let mut value = ptr::null_mut();
    if sid.is_null()
        || unsafe { IsValidSid(sid) } == 0
        || unsafe { ConvertSidToStringSidW(sid, &mut value) } == 0
    {
        return Err("Could not inspect the Windows security identifier.".into());
    }
    let _allocation = Local(value.cast());
    let mut len = 0;
    unsafe {
        while len < 256 && *value.add(len) != 0 {
            len += 1;
        }
    }
    if len == 256 {
        return Err("Invalid Windows security identifier.".into());
    }
    Ok(String::from_utf16_lossy(unsafe {
        std::slice::from_raw_parts(value, len)
    }))
}
fn current_user() -> Result<String> {
    let mut token = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err("Could not inspect the current Windows user.".into());
    }
    let result = (|| {
        let mut length = 0;
        unsafe {
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length);
        }
        if length < size_of::<TOKEN_USER>() as u32 || length > 16384 {
            return Err("Invalid Windows user token.".into());
        }
        let mut buffer = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        } == 0
        {
            return Err("Could not read the Windows user token.".into());
        }
        sid_text(unsafe { (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid })
    })();
    unsafe {
        CloseHandle(token);
    }
    result
}
fn privileged(sid: &str, user: &str) -> bool {
    sid == user
        || matches!(
            sid,
            "S-1-5-18"
                | "S-1-5-32-544"
                | "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
        )
}

pub fn validate(path: &Path, require_user_owner: bool, socket: bool) -> Result<Vec<u64>> {
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut owner = ptr::null_mut();
    let mut dacl = ptr::null_mut();
    let mut descriptor = ptr::null_mut();
    let code = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if code != 0 {
        return Err("Could not inspect the configured path's Windows permissions.".into());
    }
    let _descriptor = Local(descriptor);
    let user = current_user()?;
    let owner = sid_text(owner)?;
    if (require_user_owner && owner != user) || !privileged(&owner, &user) || dacl.is_null() {
        return Err(
            "The configured path has an untrusted Windows owner or unrestricted permissions."
                .into(),
        );
    }
    let mut acl_hash = Sha256::new();
    // Creating an unrelated sibling in an ancestor (for example C:\) is
    // not replacement of an existing checked path. Delete-child is.
    let ancestor = !require_user_owner
        && std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir());
    let mutate = if ancestor {
        0x1000_0000 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000 | 0x40
    } else {
        0x4000_0000 | 0x1000_0000 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000 | 0x156
    };
    unsafe {
        for index in 0..(*dacl).AceCount {
            let mut ace = ptr::null_mut();
            if GetAce(dacl, index as u32, &mut ace) == 0 {
                return Err("Could not inspect a Windows access rule.".into());
            }
            let header = &*ace.cast::<ACE_HEADER>();
            if header.AceSize < size_of::<ACE_HEADER>() as u16 {
                return Err("Invalid Windows access rule.".into());
            }
            acl_hash.update(std::slice::from_raw_parts(
                ace.cast::<u8>(),
                header.AceSize as usize,
            ));
            if header.AceFlags & INHERIT_ONLY_ACE as u8 != 0 {
                continue;
            }
            if header.AceType == ACCESS_ALLOWED_ACE_TYPE {
                if header.AceSize < size_of::<ACCESS_ALLOWED_ACE>() as u16 {
                    return Err("Invalid Windows allow rule.".into());
                }
                let allow = &*ace.cast::<ACCESS_ALLOWED_ACE>();
                if allow.Mask & mutate != 0
                    && !privileged(
                        &sid_text(ptr::addr_of!(allow.SidStart).cast_mut().cast())?,
                        &user,
                    )
                {
                    return Err("The configured path is writable by another Windows user. Copy remains available.".into());
                }
            } else if header.AceType != ACCESS_DENIED_ACE_TYPE
                && header.AceType != SYSTEM_AUDIT_ACE_TYPE
            {
                return Err(
                    "The configured path uses an access rule that cannot be safely verified."
                        .into(),
                );
            }
        }
    }
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err("Could not read the configured Windows file identity.".into());
    }
    let result = (|| {
        let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            return Err("Could not identify the configured Windows file.".into());
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            let mut tag = unsafe { std::mem::zeroed::<FILE_ATTRIBUTE_TAG_INFO>() };
            if unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    FileAttributeTagInfo,
                    (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                    size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
                )
            } == 0
                || !socket
                || tag.ReparseTag != 0x8000_0023
            {
                return Err("The configured path is an unexpected Windows reparse point.".into());
            }
        } else if socket {
            return Err("The selected endpoint is not a Windows AF_UNIX socket.".into());
        }
        let mut result = vec![
            info.dwVolumeSerialNumber as u64,
            (info.nFileIndexHigh as u64) << 32 | info.nFileIndexLow as u64,
            info.dwFileAttributes as u64,
        ];
        if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
            result.extend([
                (info.ftCreationTime.dwHighDateTime as u64) << 32
                    | info.ftCreationTime.dwLowDateTime as u64,
                (info.ftLastWriteTime.dwHighDateTime as u64) << 32
                    | info.ftLastWriteTime.dwLowDateTime as u64,
                (info.nFileSizeHigh as u64) << 32 | info.nFileSizeLow as u64,
            ]);
        }
        acl_hash.update(owner.as_bytes());
        let hash = acl_hash.finalize();
        for part in hash[..].as_chunks::<8>().0 {
            result.push(u64::from_le_bytes(*part));
        }
        Ok(result)
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}
