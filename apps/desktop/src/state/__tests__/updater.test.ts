import { beforeEach, describe, expect, it, vi } from "vitest";

const installAndRelaunch = vi.fn();
const downloadUpdate = vi.fn();
const checkForUpdate = vi.fn();

vi.mock("../../lib/updater", () => ({
  checkForUpdate: (...args: unknown[]) => checkForUpdate(...args),
  downloadUpdate: (...args: unknown[]) => downloadUpdate(...args),
  installAndRelaunch: (...args: unknown[]) => installAndRelaunch(...args),
}));

import { useUpdaterStore } from "../updater";

beforeEach(() => {
  vi.clearAllMocks();
  useUpdaterStore.setState({ status: "idle", version: null, notes: null, progress: null, dismissedVersion: null });
});

describe("restart() (spec 0009)", () => {
  it("a failed install/relaunch surfaces as the 'error' state instead of vanishing silently", async () => {
    useUpdaterStore.setState({ status: "ready", version: "0.1.1" });
    installAndRelaunch.mockRejectedValueOnce(new Error("app is translocated, can't replace bundle"));

    await useUpdaterStore.getState().restart();

    expect(useUpdaterStore.getState().status).toBe("error");
  });

  it("a no-op when status isn't 'ready' — never calls installAndRelaunch from another state", async () => {
    useUpdaterStore.setState({ status: "downloading", version: "0.1.1" });

    await useUpdaterStore.getState().restart();

    expect(installAndRelaunch).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("downloading");
  });

  it("on success, calls installAndRelaunch and does not touch status (the app relaunches out from under the store)", async () => {
    useUpdaterStore.setState({ status: "ready", version: "0.1.1" });
    installAndRelaunch.mockResolvedValueOnce(undefined);

    await useUpdaterStore.getState().restart();

    expect(installAndRelaunch).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });
});

describe("download() (spec 0009)", () => {
  it("a failed download surfaces as the 'error' state, not back to 'available'", async () => {
    useUpdaterStore.setState({ status: "available", version: "0.1.1" });
    downloadUpdate.mockRejectedValueOnce(new Error("network error"));

    await useUpdaterStore.getState().download();

    expect(useUpdaterStore.getState().status).toBe("error");
  });
});
