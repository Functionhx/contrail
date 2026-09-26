// Contrail: 用量数据只来自同源静态 JSON（见 ./static-data.ts）。
//
// 这个文件保留上游 api.ts 的全部导出名，好让未改动的组件照常 import；但
// 除了 6 个用量函数，其余全是**不发任何请求**的空实现——云端账户、排行榜、
// 登录、额度查询、会话浏览在一个公开的静态页面里都不存在。

import {
  getStaticUsageDaily,
  getStaticUsageHeatmap,
  getStaticUsageHourly,
  getStaticUsageModelBreakdown,
  getStaticUsageMonthly,
  getStaticUsageSummary,
} from "./static-data";

type AnyRecord = Record<string, any>;

export const getUsageSummary = (opts: AnyRecord = {}) => getStaticUsageSummary(opts);
export const getUsageDaily = (opts: AnyRecord = {}) => getStaticUsageDaily(opts);
export const getUsageMonthly = (opts: AnyRecord = {}) => getStaticUsageMonthly(opts);
export const getUsageHourly = (opts: AnyRecord = {}) => getStaticUsageHourly(opts);
export const getUsageHeatmap = (opts: AnyRecord = {}) => getStaticUsageHeatmap(opts);
export const getUsageModelBreakdown = (opts: AnyRecord = {}) => getStaticUsageModelBreakdown(opts);

// 云端「账户视图」与本地是同一形状；静态站没有云端，直接走同一份数据。
export const fetchCloudUsageSummary = getUsageSummary;
export const fetchCloudUsageDaily = getUsageDaily;
export const fetchCloudUsageMonthly = getUsageMonthly;
export const fetchCloudUsageHourly = getUsageHourly;
export const fetchCloudUsageHeatmap = getUsageHeatmap;
export const fetchCloudUsageModelBreakdown = getUsageModelBreakdown;

const unavailable = async (..._args: any[]): Promise<any> => ({ available: false });

export function invalidateAccountResponseCache() {}
export function invalidateSessionInsightsCache() {}

export const getProjectUsageSummary = async (..._args: any[]) => ({ entries: [] });
export const getProjectUsageDetail = unavailable;
export const getLocalAchievements = async (..._args: any[]) => ({ achievements: [] });
export const getLeaderboard = unavailable;
export const getCommunityModels = unavailable;
export const getPublicVisibility = unavailable;
export const setPublicVisibility = unavailable;
export const refreshLeaderboard = unavailable;
export const getLeaderboardProfile = unavailable;
export const getUserBadges = unavailable;
export const getProfileLikes = unavailable;
export const setProfileLike = unavailable;
export const getUserStatus = unavailable;
export const triggerLocalSync = unavailable;
export const getOutcomes = async (..._args: any[]) => ({ available: false, by_model: [], by_tool: [], totals: null });
export const getSessionInsights = async (..._args: any[]) => ({ available: false, sessions: [], by_model: [], subagents: [] });
export const getContextHealth = unavailable;
export const getUsageCategoryBreakdown = unavailable;
export const getUsageLimits = unavailable;
export const fetchAccountDevices = async (..._args: any[]) => ({ devices: [] });
export const renameAccountDevice = unavailable;
