import React from "react";
import { Shell } from "../../components";
import { CostAnalysisModal } from "../components/CostAnalysisModal.jsx";
import { DataDetails } from "../components/DataDetails.jsx";
import { StatsPanel } from "../components/StatsPanel.jsx";
import { UsageOverview } from "../components/UsageOverview.jsx";
import { TrendMonitor } from "../components/TrendMonitor.jsx";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { DashboardSkeleton } from "../../../components/DashboardSkeleton.jsx";

// Contrail：固定两栏、六张卡，只读展示。
//
// 上游在这里还有 Mac App / 灵动岛 / 小组件推广卡、安装命令、设备用量、
// 性价比与会话洞察卡、登录门禁，以及拖拽排序——都属于「本机客户端」或
// 「云端账户」的功能，公开静态页面里用不上，全部去掉。

// 入场动画的阶梯间隔，与上游一致。
const STEP = 0.06;
const D_LEFT_BASE = 0.11;
const D_RIGHT_BASE = 0.05;

export function DashboardView(props) {
  const {
    copy,
    period,
    identityStartDate,
    activeDays,
    identitySubscriptions,
    summaryConversationsValue,
    rollingUsage,
    topModels,
    activityHeatmapBlock,
    trendRowsForDisplay,
    trendFromForDisplay,
    trendToForDisplay,
    trendTimeZoneLabel,
    trendZoomConfig,
    periodsForDisplay,
    setSelectedPeriod,
    summaryLabel,
    summaryValue,
    summaryFullValue,
    hasSummary,
    summaryLoading,
    providersLoading,
    onToggleSummaryFormat,
    summaryCostValue,
    costInfoEnabled,
    openCostModal,
    costModalOpen,
    closeCostModal,
    fleetData,
    usageLoadingState,
    announceUsageLoading,
    customFrom,
    customTo,
    onCustomRangeApply,
    customRangeOpen,
    onCustomRangeOpenChange,
    usageFrom,
    usageTo,
    deviceOptions,
    selectedDevice,
    onDeviceChange,
    initialDashboardLoading,
    hasDetailsActual,
    dailyEmptyPrefix,
    installSyncCmd,
    dailyEmptySuffix,
    detailsColumns,
    ariaSortFor,
    toggleSort,
    sortIconFor,
    pagedDetails,
    dailyBreakdownRows,
    dailyBreakdownColumns,
    dailyBreakdownAriaSortFor,
    dailyBreakdownSortIconFor,
    dailyBreakdownDateKey,
    detailsDateKey,
    renderDetailDate,
    renderDailyBreakdownDate,
    renderDetailCell,
    DETAILS_PAGED_PERIODS,
    detailsPageCount,
    detailsPage,
    setDetailsPage,
  } = props;

  const left = [
    <StatsPanel
      key="stats"
      title={copy("dashboard.identity.title")}
      subtitle={copy("dashboard.identity.subtitle")}
      period={period}
      startDate={identityStartDate ?? copy("identity_card.rank_placeholder")}
      streakDays={activeDays}
      subscriptions={identitySubscriptions}
      periodConversations={summaryConversationsValue}
      rolling={rollingUsage}
      topModels={topModels}
    />,
    activityHeatmapBlock ? <React.Fragment key="heatmap">{activityHeatmapBlock}</React.Fragment> : null,
    <TrendMonitor
      key="trend"
      rows={trendRowsForDisplay}
      from={trendFromForDisplay}
      to={trendToForDisplay}
      period={period}
      timeZoneLabel={trendTimeZoneLabel}
      showTimeZoneLabel={false}
      zoomConfig={trendZoomConfig}
    />,
  ].filter(Boolean);

  const right = [
    <UsageOverview
      key="overview"
      period={period}
      periods={periodsForDisplay}
      onPeriodChange={setSelectedPeriod}
      summaryLabel={summaryLabel}
      summaryValue={summaryValue}
      summaryFullValue={summaryFullValue}
      hasSummary={hasSummary}
      summaryLoading={summaryLoading}
      providersLoading={providersLoading}
      onToggleSummaryFormat={hasSummary ? onToggleSummaryFormat : null}
      summaryCostValue={summaryCostValue}
      onCostInfo={costInfoEnabled ? openCostModal : null}
      fleetData={fleetData}
      onRefresh={null}
      loading={usageLoadingState}
      announceLoading={announceUsageLoading}
      onOpenShare={null}
      customFrom={customFrom}
      customTo={customTo}
      onCustomRangeApply={onCustomRangeApply}
      customRangeOpen={customRangeOpen}
      onCustomRangeOpenChange={onCustomRangeOpenChange}
      from={usageFrom}
      to={usageTo}
      deviceOptions={deviceOptions}
      selectedDevice={selectedDevice}
      onDeviceChange={onDeviceChange}
    />,
    <DataDetails
      key="details"
      projectEntries={[]}
      copy={copy}
      hasDetailsActual={hasDetailsActual}
      dailyEmptyPrefix={dailyEmptyPrefix}
      installSyncCmd={installSyncCmd}
      dailyEmptySuffix={dailyEmptySuffix}
      detailsColumns={detailsColumns}
      ariaSortFor={ariaSortFor}
      toggleSort={toggleSort}
      sortIconFor={sortIconFor}
      pagedDetails={pagedDetails}
      dailyBreakdownRows={dailyBreakdownRows}
      dailyBreakdownColumns={dailyBreakdownColumns}
      dailyBreakdownAriaSortFor={dailyBreakdownAriaSortFor}
      dailyBreakdownSortIconFor={dailyBreakdownSortIconFor}
      dailyBreakdownDateKey={dailyBreakdownDateKey}
      detailsDateKey={detailsDateKey}
      renderDetailDate={renderDetailDate}
      renderDailyBreakdownDate={renderDailyBreakdownDate}
      renderDetailCell={renderDetailCell}
      DETAILS_PAGED_PERIODS={DETAILS_PAGED_PERIODS}
      period={period}
      detailsPageCount={detailsPageCount}
      detailsPage={detailsPage}
      setDetailsPage={setDetailsPage}
    />,
  ];

  return (
    <>
      <Shell>
        {initialDashboardLoading ? (
          <DashboardSkeleton />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-4 flex flex-col gap-4 min-w-0 order-2 lg:order-1">
              {left.map((card, i) => (
                <FadeIn key={card.key} delay={D_LEFT_BASE + STEP * i}>{card}</FadeIn>
              ))}
            </div>
            <div className="lg:col-span-8 flex flex-col gap-4 min-w-0 order-1 lg:order-2">
              {right.map((card, i) => (
                <FadeIn key={card.key} delay={D_RIGHT_BASE + STEP * i}>{card}</FadeIn>
              ))}
            </div>
          </div>
        )}
      </Shell>
      <CostAnalysisModal isOpen={costModalOpen} onClose={closeCostModal} fleetData={fleetData} />
    </>
  );
}
