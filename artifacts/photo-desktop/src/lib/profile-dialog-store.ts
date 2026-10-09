import { create } from "zustand";

// The settings dialog belongs to the app, not either responsive launcher.
export const useProfileDialogStore = create<{
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;
}>((set) => ({
  profileOpen: false,
  setProfileOpen: (profileOpen) => set({ profileOpen }),
}));
