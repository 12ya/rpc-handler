import { JsonRpcProvider } from "@ethersproject/providers";
// import { LOCAL_HOST, networkRpcs, networkNames } from "./constants";
import { LOCAL_HOST, getNetworkRpcs, networkNames } from "./constants";
import { HandlerInterface, HandlerConstructorConfig } from "./handler";

import { RPCService } from "../src/services/rpc-service";
import { StorageService } from "../src/services/storage-service";

export class RPCHandler implements HandlerInterface {
  private static _instance: RPCHandler | null = null;
  private _provider: JsonRpcProvider | null = null;
  private _networkId: number;
  private _networkName: string;
  private _env: string = "node";
  private _excludeTrackingRPCs: boolean = false;

  private _rpcTimeout: number = Number.MAX_SAFE_INTEGER; // ms
  private _cacheRefreshCycles: number = 10;
  private _refreshLatencies: number = 0;
  private _autoStorage: boolean = false;

  private _runtimeRpcs: string[] = [];
  private _latencies: Record<string, number> = {};

  private _networkRpcs: string[] = [];

  constructor(config: HandlerConstructorConfig) {
    this._networkId = config.networkId;
    this._networkName = networkNames[this._networkId];
    this._excludeTrackingRPCs = config.excludeTrackingRPCs;
    this._networkRpcs = getNetworkRpcs(this._networkId, this._excludeTrackingRPCs);
    this._initialize(config);
  }

  public async getFastestRpcProvider(): Promise<JsonRpcProvider> {
    if (this._networkId === 31337) {
      this._provider = new JsonRpcProvider(LOCAL_HOST, this._networkId);
    } else if (!this._provider) {
      this._provider = await this.testRpcPerformance();
    }

    if (this._provider && this._provider?.connection.url.includes("localhost") && this._networkId !== 31337) {
      /**
       * The JsonRpcProvider defaults erroneously to localhost:8545
       * this is a fix for that
       *  static defaultUrl(): string {
       *    return "http:/\/localhost:8545";
       *  }
       */
      this._provider = await this.testRpcPerformance();
    }

    return this._provider;
  }

  public async testRpcPerformance(): Promise<JsonRpcProvider> {
    const shouldRefreshRpcs =
      Object.keys(this._latencies).filter((rpc) => rpc.startsWith(`${this._networkId}__`)).length <= 1 || this._refreshLatencies >= this._cacheRefreshCycles;

    if (shouldRefreshRpcs) {
      this._runtimeRpcs = networkRpcs[this._networkId];
      this._refreshLatencies = 0;
    } else {
      this._runtimeRpcs = Object.keys(this._latencies).map((rpc) => {
        return rpc.split("__")[1];
      });
    }

    await this._testRpcPerformance();

    const fastestRpcUrl = await RPCService.findFastestRpc(this._latencies, this._networkId);

    if (!fastestRpcUrl) {
      throw new Error("Failed to find fastest RPC");
    }

    const provider = new JsonRpcProvider(fastestRpcUrl, this._networkId);
    this._provider = provider;

    if (this._autoStorage) {
      StorageService.setLatencies(this._env, this._latencies);
      StorageService.setRefreshLatencies(this._env, this._refreshLatencies);
    }

    if (!this._provider) {
      throw new Error("Provider could not be initialized");
    }

    return this._provider;
  }

  public getProvider(): JsonRpcProvider {
    if (!this._provider) {
      throw new Error("Provider is not initialized");
    }
    return this._provider;
  }

  public static getInstance(config: HandlerConstructorConfig): RPCHandler {
    if (!RPCHandler._instance) {
      if (!config) {
        throw new Error("Config is required to initialize RPCHandler");
      }

      RPCHandler._instance = new RPCHandler(config);
    }
    return RPCHandler._instance;
  }
  public clearInstance(): void {
    RPCHandler._instance = null;
  }

  public getRuntimeRpcs(): string[] {
    return this._runtimeRpcs;
  }

  public getNetworkId(): number {
    return this._networkId;
  }

  public getNetworkName(): string {
    return this._networkName;
  }

  public getNetworkRpcs(): string[] {
    return this._networkRpcs;
  }

  public getLatencies(): Record<string, number> {
    return this._latencies;
  }

  public getRefreshLatencies(): number {
    return this._refreshLatencies;
  }

  public getCacheRefreshCycles(): number {
    return this._cacheRefreshCycles;
  }

  private async _testRpcPerformance(): Promise<void> {
    const { latencies, runtimeRpcs } = await RPCService.testRpcPerformance(
      this._networkId,
      this._latencies,
      this._runtimeRpcs,
      { "Content-Type": "application/json" },
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
        id: 1,
      }),
      this._rpcTimeout
    );

    this._runtimeRpcs = runtimeRpcs;
    this._latencies = latencies;
    this._refreshLatencies++;

    StorageService.setLatencies(this._env, this._latencies);
    StorageService.setRefreshLatencies(this._env, this._refreshLatencies);
  }
  private _updateConfig(config: HandlerConstructorConfig): void {
    if (config.networkName) {
      this._networkName = config.networkName;
    }

    if (config.networkRpcs) {
      this._networkRpcs = [...this._networkRpcs, ...config.networkRpcs];
    }

    if (config.runtimeRpcs) {
      this._runtimeRpcs = config.runtimeRpcs;
    }

    if (config.cacheRefreshCycles) {
      this._cacheRefreshCycles = config.cacheRefreshCycles;
    }

    if (config.rpcTimeout) {
      this._rpcTimeout = config.rpcTimeout;
    }

    if (config.autoStorage) {
      this._autoStorage = true;
      this._latencies = StorageService.getLatencies(this._env, this._networkId);
      this._refreshLatencies = StorageService.getRefreshLatencies(this._env);
    }
  }

  private _initialize(config: HandlerConstructorConfig): void {
    this._env = typeof window === "undefined" ? "node" : "browser";
    this._updateConfig(config);
  }
}
