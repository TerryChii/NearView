import type { NearViewApi } from "../shared/types";

declare global {
  interface Window {
    nearview: NearViewApi;
  }
}

export {};
