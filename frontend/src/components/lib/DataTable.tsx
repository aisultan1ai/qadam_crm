import { ReactNode, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, rowIndex: number) => ReactNode;
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
  align?: "left" | "center" | "right";
  width?: number | string;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  empty?: ReactNode;
  className?: string;
  striped?: boolean;
  compact?: boolean;
  initialSort?: { key: string; direction: SortDirection };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading = false,
  empty,
  className,
  striped = false,
  compact = false,
  initialSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortAccessor) return rows;
    const acc = col.sortAccessor;
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (va == null && vb == null) return 0;
      if (va == null) return sign;
      if (vb == null) return -sign;
      if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * sign;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
      return String(va).localeCompare(String(vb)) * sign;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return undefined;
    });
  };

  if (!isLoading && rows.length === 0 && empty) {
    return <div className={clsx("table-container", className)}>{empty}</div>;
  }

  return (
    <div className={clsx("table-container", className)}>
      <div className="table-scroll">
        <table className="w-full border-collapse">
          <thead className="table-head">
            <tr>
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const canSort = !!(c.sortable && c.sortAccessor);
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={clsx(
                      "table-head-cell",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      canSort && "cursor-pointer select-none hover:text-neutral-900 dark:hover:text-white",
                      c.headerClassName,
                    )}
                    onClick={canSort ? () => toggleSort(c.key) : undefined}
                    aria-sort={
                      canSort
                        ? isSorted
                          ? sort?.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {canSort &&
                        (isSorted ? (
                          sort?.direction === "asc" ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )
                        ) : (
                          <ChevronsUpDown size={11} className="opacity-40" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="table-row">
                  {columns.map((c) => (
                    <td key={c.key} className={clsx("table-cell", compact && "!py-1.5")}>
                      <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              sortedRows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className={clsx(
                    "table-row",
                    onRowClick && "cursor-pointer",
                    striped && i % 2 === 1 && "bg-neutral-50/50 dark:bg-neutral-800/20",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx(
                        "table-cell",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        compact && "!py-1.5",
                        c.className,
                      )}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
