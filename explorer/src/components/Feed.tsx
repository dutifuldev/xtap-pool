import { useCallback, useEffect, useRef, useState } from "react";

import type { Filters, TweetPage, TweetRecord } from "../lib/api.js";
import { fetchTweets } from "../lib/api.js";
import { nextTweetDateRefreshDelay } from "../lib/format.js";
import { TweetCard } from "./TweetCard.js";

export type FeedProps = {
  filters: Filters;
};

type FeedState = {
  records: readonly TweetRecord[];
  nextCursor?: string;
  loading: boolean;
  error?: string;
};

function nextFeedRefreshDelay(records: readonly TweetRecord[], now: Date): number | undefined {
  let next: number | undefined;
  for (const record of records) {
    const delay = nextTweetDateRefreshDelay(
      record.tweet.created_at ?? record.tweet.captured_at,
      now,
    );
    if (delay !== undefined && (next === undefined || delay < next)) next = delay;
  }
  return next;
}

function useFeedClock(records: readonly TweetRecord[]): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const delay = nextFeedRefreshDelay(records, now);
    if (delay === undefined) return;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
    }, delay);
    return (): void => {
      window.clearTimeout(timeout);
    };
  }, [records, now]);

  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return (): void => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return now;
}

/** Infinite-scrolling tweet feed for the active filters. */
export function Feed({ filters }: FeedProps): React.JSX.Element {
  const [state, setState] = useState<FeedState>({ records: [], loading: true });
  const generation = useRef(0);
  const now = useFeedClock(state.records);

  const load = useCallback(
    async (cursor: string | undefined, previous: readonly TweetRecord[]): Promise<void> => {
      const requestGeneration = generation.current;
      setState((current) => ({ ...current, loading: true }));
      try {
        const page: TweetPage = await fetchTweets(filters, cursor);
        if (generation.current !== requestGeneration) return;
        setState({
          records: [...previous, ...page.records],
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          loading: false,
        });
      } catch (error) {
        if (generation.current !== requestGeneration) return;
        const message = error instanceof Error ? error.message : "failed to load";
        setState({ records: previous, loading: false, error: message });
      }
    },
    [filters],
  );

  useEffect(() => {
    generation.current += 1;
    void load(undefined, []);
  }, [load]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { nextCursor, loading, records } = state;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || nextCursor === undefined || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void load(nextCursor, records);
      }
    });
    observer.observe(sentinel);
    return (): void => {
      observer.disconnect();
    };
  }, [load, nextCursor, loading, records]);

  return (
    <div>
      <ul className="x-feed">
        {state.records.map((record, index) => (
          <li
            className="x-feed__item"
            key={`${record.tweet.id}-${record.tweet.contributed_by}-${String(index)}`}
          >
            <TweetCard tweet={record.tweet} contributors={record.contributors} now={now} />
          </li>
        ))}
      </ul>
      {state.error !== undefined ? <p className="p-4 text-sm text-red-500">{state.error}</p> : null}
      {state.loading ? <p className="p-4 text-sm text-(--x-muted)">Loading…</p> : null}
      {!state.loading && state.records.length === 0 && state.error === undefined ? (
        <p className="p-4 text-sm text-(--x-muted)">No tweets match these filters yet.</p>
      ) : null}
      {state.nextCursor !== undefined && !state.loading ? (
        <div ref={sentinelRef}>
          <button
            type="button"
            className="m-4 rounded-full border border-(--x-border) bg-(--x-soft) px-4 py-1.5 text-sm font-semibold"
            onClick={() => {
              void load(state.nextCursor, state.records);
            }}
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
