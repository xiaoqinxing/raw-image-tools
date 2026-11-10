import React from 'react';

export const ANALYSIS_DOCK_MIN_HEIGHT = 160;
export const ANALYSIS_DOCK_MIN_CANVAS_HEIGHT = 160;
export const ANALYSIS_DOCK_KEY_STEP = 16;

/** Largest dock height that still leaves room for the canvas. */
export function analysisDockMaxHeight(availableHeight: number): number {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return ANALYSIS_DOCK_MIN_HEIGHT;
  return Math.max(ANALYSIS_DOCK_MIN_HEIGHT, Math.round(availableHeight - ANALYSIS_DOCK_MIN_CANVAS_HEIGHT));
}

/** Clamp a requested dock height to the current main-column height. */
export function clampAnalysisDockHeight(requested: number, availableHeight: number): number {
  const max = analysisDockMaxHeight(availableHeight);
  return Math.min(max, Math.max(ANALYSIS_DOCK_MIN_HEIGHT, Math.round(requested)));
}

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  active: boolean;
}

/**
 * Adds a top-edge resize handle to the analysis dock. The returned style is
 * undefined until the user resizes, so the responsive CSS defaults stay intact.
 */
export function useAnalysisDockResize(dock: HTMLDivElement | null, enabled: boolean) {
  const [height, setHeight] = React.useState<number | null>(null);
  const [availableHeight, setAvailableHeight] = React.useState(0);
  const [renderedHeight, setRenderedHeight] = React.useState(0);
  const [resizing, setResizing] = React.useState(false);
  const dragRef = React.useRef<DragState | null>(null);

  React.useLayoutEffect(() => {
    const parent = dock?.parentElement;
    if (!dock || !parent) return;

    const parentObserver = new ResizeObserver(() => {
      setAvailableHeight(parent.clientHeight);
    });
    const dockObserver = new ResizeObserver(() => {
      const next = dock.getBoundingClientRect().height;
      setRenderedHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    });
    parentObserver.observe(parent);
    dockObserver.observe(dock);
    setAvailableHeight(parent.clientHeight);
    setRenderedHeight(dock.getBoundingClientRect().height);

    return () => {
      parentObserver.disconnect();
      dockObserver.disconnect();
    };
  }, [dock]);

  React.useEffect(() => () => {
    document.body.classList.remove('analysis-resizing');
  }, []);

  const clampWith = React.useCallback((value: number) => {
    const parentHeight = dock?.parentElement?.clientHeight ?? availableHeight;
    return clampAnalysisDockHeight(value, parentHeight);
  }, [dock, availableHeight]);

  const stopResizing = React.useCallback(() => {
    dragRef.current = null;
    setResizing(false);
    document.body.classList.remove('analysis-resizing');
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !dock) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: dock.getBoundingClientRect().height,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('analysis-resizing');
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !event.isPrimary) return;
    const delta = drag.startY - event.clientY;
    if (!drag.active) {
      if (Math.abs(delta) < 2) return;
      drag.active = true;
      setResizing(true);
    }
    event.preventDefault();
    setHeight(clampWith(drag.startHeight + delta));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    stopResizing();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onLostPointerCapture = () => {
    if (!dragRef.current) return;
    stopResizing();
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setHeight(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!dock) return;
    const current = dock.getBoundingClientRect().height;
    let next: number | null = null;
    if (event.key === 'ArrowUp') next = current + ANALYSIS_DOCK_KEY_STEP;
    else if (event.key === 'ArrowDown') next = current - ANALYSIS_DOCK_KEY_STEP;
    else if (event.key === 'Home') next = ANALYSIS_DOCK_MIN_HEIGHT;
    else if (event.key === 'End') next = Number.MAX_SAFE_INTEGER;
    else if (event.key === 'Enter') {
      event.preventDefault();
      setHeight(null);
      return;
    }
    if (next == null) return;
    event.preventDefault();
    setHeight(clampWith(next));
  };

  const appliedHeight = enabled && height != null && availableHeight > 0
    ? clampAnalysisDockHeight(height, availableHeight)
    : null;
  const style: React.CSSProperties | undefined = appliedHeight == null
    ? undefined
    : { height: appliedHeight, minHeight: 0 };
  const ariaHeight = Math.round(renderedHeight || appliedHeight || 0);

  return {
    style,
    resizing,
    handleProps: {
      role: 'separator' as const,
      'aria-orientation': 'horizontal' as const,
      'aria-label': '调整分析面板高度',
      'aria-valuemin': ANALYSIS_DOCK_MIN_HEIGHT,
      'aria-valuemax': analysisDockMaxHeight(availableHeight),
      'aria-valuenow': ariaHeight,
      'aria-valuetext': `${ariaHeight} 像素`,
      tabIndex: 0,
      title: '上下拖动调整分析面板高度 · 双击或按 Enter 恢复默认',
      'data-testid': 'analysis-resize-handle',
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture,
      onDoubleClick,
      onKeyDown,
    },
  };
}
