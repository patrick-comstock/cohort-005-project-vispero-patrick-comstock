import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => {});

/**
 * The app's one status region (WCAG 4.1.3, technique ARIA22). It is rendered
 * empty from the first render and never mounted conditionally, so screen
 * readers have registered it before anything is announced. Use it for the
 * results of the user's own actions.
 */
export function StatusRegionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [message, setMessage] = useState("");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear the region first, so repeating the same message is announced again.
  const announce = useCallback<Announce>((next) => {
    clearTimeout(timeout.current);
    setMessage("");
    timeout.current = setTimeout(() => setMessage(next), 100);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Announces a short sentence through the app's status region. */
export function useAnnounce() {
  return useContext(AnnounceContext);
}
