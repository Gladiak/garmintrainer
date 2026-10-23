import { useLayoutEffect, useState } from 'react';

export function useGridColumns(container) {
  const [columns, setColumns] = useState(4);
  useLayoutEffect(() => {
    const element = container.current;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      setColumns(width < 560 ? 1 : width < 920 ? 2 : 4);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  return columns;
}
