//! ConPTY does not expose a reliable foreground-agent/tab mapping here yet.
//! Keep image Copy available rather than treating all Windows as agent sessions.
use super::*;

#[derive(Clone, Debug)]
pub struct Target;

const UNAVAILABLE: &str = "Automatic agent detection is not available for Windows Terminal yet. Copy image, switch to your agent, and use its image-paste shortcut.";

pub fn discover() -> Result<Vec<super::Target>> {
    Err(UNAVAILABLE.into())
}
pub fn activate(_: &Target) -> Result<()> {
    Err(UNAVAILABLE.into())
}
pub fn focused(_: &Target) -> bool {
    false
}
pub fn paste(_: &Target) -> Result<()> {
    Err(UNAVAILABLE.into())
}
