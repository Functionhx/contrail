import React from "react";
import { Card } from "../../components";

// Contrail：只保留「每日明细」。上游的「项目用量」标签依赖本机项目名与
// GitHub 头像，公开数据里刻意没有项目维度，所以整块去掉。

export function DataDetails({
  copy,
  hasDetailsActual,
  dailyEmptyPrefix,
  installSyncCmd,
  dailyEmptySuffix,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
}) {
  return (
    <Card>
      <h2 className="text-xs font-medium px-3 py-1.5 mb-0 inline-block rounded text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800">
        {copy("dashboard.daily.title")}
      </h2>

      {/* Daily Tab */}
      {(
        <div>
          {dailyBreakdownRows?.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
              {dailyEmptyPrefix}
              <code className="mx-1 rounded border border-oai-gray-300 dark:border-oai-gray-700 oai-bg-elevated px-1.5 py-0.5 font-mono oai-text-caption">
                {installSyncCmd}
              </code>
              {dailyEmptySuffix}
            </div>
          ) : (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {dailyBreakdownColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={dailyBreakdownAriaSortFor?.(column.key) || "none"}
                      className="text-left p-0 bg-white dark:bg-oai-gray-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-center justify-start px-2.5 sm:px-4 py-2 text-left oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-oai-gray-400 dark:text-oai-gray-400">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyBreakdownRows.map((row) => (
                  <tr
                    key={String(
                      row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "",
                    )}
                    className={`border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0 hover:bg-oai-gray-50/50 dark:hover:bg-oai-gray-800/50 transition-colors ${
                      row.missing ? "text-oai-gray-400 dark:text-oai-gray-400" : row.future ? "text-oai-gray-300 dark:text-oai-gray-600" : "text-oai-black dark:text-oai-white"
                    }`}
                  >
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 whitespace-nowrap">
                      {renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row)}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                      {renderDetailCell(row, "total_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "cached_input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "reasoning_output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "conversation_count")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

        </div>
      )}
    </Card>
  );
}
