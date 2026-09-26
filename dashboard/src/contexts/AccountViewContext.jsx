// Contrail: 没有云端账户视图，数据永远来自同源静态 JSON。
import React from "react";

const VALUE = Object.freeze({ accountView: false, revision: 0, localHost: true, resolving: false });

export const CLOUD_SYNC_CHANGE_EVENT = "tt.cloudSyncChanged";
export function emitCloudSyncChange() {}

export function AccountViewProvider({ children }) {
  return <>{children}</>;
}

export function useAccountView() {
  return VALUE;
}
