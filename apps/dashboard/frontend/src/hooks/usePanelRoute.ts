import { useCallback, useEffect, useState } from 'react';

export function usePanelRoute(validIds: string[], defaultId: string) {
  const validate = useCallback(
    (raw: string | null): string => {
      if (!raw) return defaultId;
      const id = raw.replace(/^#/, '');
      return validIds.includes(id) ? id : defaultId;
    },
    [validIds, defaultId],
  );

  const [active, setActive] = useState<string>(() => {
    if (typeof window === 'undefined') return defaultId;
    const hash = window.location.hash;
    const id = hash ? hash.slice(1) : null;
    if (!id) return defaultId;
    return validate(hash);
  });

  const setActivePanel = useCallback(
    (id: string) => {
      const next = validate(id);
      setActive(next);
      if (typeof window !== 'undefined') {
        const target = `#${next}`;
        if (window.location.hash !== target) {
          window.location.hash = target;
        }
      }
    },
    [validate],
  );

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      setActive(validate(hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [validate]);

  return [active, setActivePanel] as const;
}
