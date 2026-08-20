import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

type Props<T> = {
  items: T[];
  /** Ожидаемая высота одной строки в px. Используется как estimateSize; сама вертикальная позиция считается точно. */
  itemHeight: number;
  /** Высота видимой области — фиксированная (в px или CSS unit). Обязательна для реальной виртуализации. */
  height: number | string;
  /** Ключ строки (по умолчанию — index). */
  getKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Обёртка вокруг строки. Полезно, если нужно сохранить grid layout — тогда renderItem возвращает содержимое ячеек. */
  rowClassName?: string;
  className?: string;
  overscan?: number;
  /** Пока items.length <= threshold — рендерим обычным map (быстрее initial paint). */
  threshold?: number;
};

/**
 * Универсальная виртуализированная лента. При количестве элементов ≤ threshold
 * работает как обычный map (без absolute-позиционирования и фиксированной высоты
 * контейнера). При превышении — включается @tanstack/react-virtual с overscan.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  height,
  getKey,
  renderItem,
  rowClassName,
  className = "",
  overscan = 8,
  threshold = 50,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  if (items.length <= threshold) {
    return (
      <div className={className}>
        {items.map((it, i) => (
          <div key={getKey ? getKey(it, i) : i} className={rowClassName}>
            {renderItem(it, i)}
          </div>
        ))}
      </div>
    );
  }

  return <VirtualCore
    items={items}
    itemHeight={itemHeight}
    height={height}
    getKey={getKey}
    renderItem={renderItem}
    rowClassName={rowClassName}
    className={className}
    overscan={overscan}
    parentRef={parentRef}
  />;
}

function VirtualCore<T>({
  items, itemHeight, height, getKey, renderItem, rowClassName, className, overscan, parentRef,
}: Omit<Props<T>, "threshold"> & { parentRef: React.RefObject<HTMLDivElement> }) {
  const rv = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  });

  return (
    <div ref={parentRef} className={`overflow-auto ${className}`} style={{ height }}>
      <div style={{ height: rv.getTotalSize(), position: "relative", width: "100%" }}>
        {rv.getVirtualItems().map((vi) => {
          const item = items[vi.index];
          return (
            <div
              key={getKey ? getKey(item, vi.index) : vi.key}
              className={rowClassName}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
                height: vi.size,
              }}
            >
              {renderItem(item, vi.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
