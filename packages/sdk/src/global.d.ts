// Ambient module declarations for optional peer dependencies.
//
// Most of the SDK never statically imports these packages (that would force
// every consumer to install every adapter's dependency) — adapters instead
// take the library's object/ref as a parameter, typed structurally. The
// exception is hook-based adapters (Recoil, React Router) whose only entry
// point is a hook that must be imported statically to be called at all;
// those still don't force the dependency on non-users since the *adapter
// subpath* itself is only imported by consumers who use that library. These
// declarations just keep `tsc` happy about the module specifiers existing,
// typed as `any` — each adapter narrows what it needs at the call site.

declare module "react-native";
declare module "expo-constants";
declare module "@react-navigation/native";
declare module "redux";
declare module "zustand";
declare module "zustand/vanilla";
declare module "jotai";
declare module "jotai/vanilla";
declare module "recoil";
declare module "mobx";
declare module "@react-native-async-storage/async-storage";
declare module "react-native-mmkv";
declare module "realm";
declare module "react-router-dom";
