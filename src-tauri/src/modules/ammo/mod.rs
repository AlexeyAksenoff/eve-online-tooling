//! Ammo reference — a sortable quick-reference of Small turret charges
//! (Hybrid/Projectile/Laser, T1/Navy/T2) with their damage, range and
//! tracking multipliers. `commands` resolves tier and turret-class
//! classification from the raw `sde::AmmoChargeAttrs` rows; the SQL itself
//! lives in `sde::db::ammo` (the SDE service), per the repo's "module calls
//! the service, never reaches around it" convention.

pub mod commands;
