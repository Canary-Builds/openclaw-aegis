import type {
  PlatformAdapter,
  PlatformInstallConfig,
  PlatformServiceStatus,
} from "../types/index.js";

export class LaunchdAdapter implements PlatformAdapter {
  readonly name = "launchd";

  install(_config: PlatformInstallConfig): Promise<void> {
    return Promise.reject(
      new Error("LaunchdAdapter is not implemented in v1.0. See issue #373 for roadmap."),
    );
  }

  start(): Promise<void> {
    return Promise.reject(new Error("LaunchdAdapter is not implemented in v1.0."));
  }

  stop(): Promise<void> {
    return Promise.reject(new Error("LaunchdAdapter is not implemented in v1.0."));
  }

  restart(): Promise<void> {
    return Promise.reject(new Error("LaunchdAdapter is not implemented in v1.0."));
  }

  status(): Promise<PlatformServiceStatus> {
    return Promise.resolve("unknown");
  }

  notifyWatchdog(): Promise<void> {
    return Promise.resolve();
  }
}
