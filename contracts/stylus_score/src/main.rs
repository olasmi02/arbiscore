#![cfg_attr(not(feature = "export-abi"), no_main)]

#[cfg(feature = "export-abi")]
fn main() {
    stylus_sdk::abi::export::print_license_and_pragma("MIT OR Apache-2.0", "pragma solidity ^0.8.23;");
    stylus_sdk::abi::export::print_from_args::<arbiscore_engine::ArbiScoreEngine>();
}

#[cfg(not(feature = "export-abi"))]
fn main() {}
