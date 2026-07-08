import { useEffect, useRef } from 'react';

import { useProfile } from '@entities/user/api/useAuth';
import { authApi } from '@shared/api/api-client';

const HEARTBEAT_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 90_000;
const LEADER_CHECK_INTERVAL_MS = 5_000;
const LEASE_STORAGE_KEY = 'budgero:activity-heartbeat-lease';
const LEASE_CHANNEL_NAME = 'budgero:activity-heartbeat';

type HeartbeatLease = {
  tabId: string;
  expiresAt: number;
};

function createTabID() {
  return globalThis.crypto?.randomUUID?.() ?? `heartbeat-${Date.now()}-${Math.random()}`;
}

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function isVisible() {
  return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
}

function readLease(): HeartbeatLease | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeartbeatLease>;
    if (typeof parsed.tabId !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return {
      tabId: parsed.tabId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function writeLease(lease: HeartbeatLease) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify(lease));
}

export function ActivityHeartbeat() {
  const profileQuery = useProfile();
  const tabIdRef = useRef(createTabID());

  useEffect(() => {
    const userID = profileQuery.data?.id;
    if (!userID || typeof window === 'undefined') {
      return;
    }

    const tabID = tabIdRef.current;
    const broadcastChannel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LEASE_CHANNEL_NAME) : null;

    let disposed = false;
    let isLeader = false;
    let leaderCheckTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let immediateTimer: number | null = null;

    const clearTimers = () => {
      if (leaderCheckTimer !== null) {
        window.clearInterval(leaderCheckTimer);
        leaderCheckTimer = null;
      }
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (immediateTimer !== null) {
        window.clearTimeout(immediateTimer);
        immediateTimer = null;
      }
    };

    const releaseLeaseIfOwned = () => {
      const lease = readLease();
      if (!lease || lease.tabId !== tabID) return;
      try {
        window.localStorage.removeItem(LEASE_STORAGE_KEY);
      } catch {
        /* no-op */
      }
    };

    const announceLease = (lease: HeartbeatLease) => {
      writeLease(lease);
      broadcastChannel?.postMessage({ type: 'lease', lease });
    };

    const hasActiveForeignLeader = () => {
      const lease = readLease();
      return Boolean(lease && lease.tabId !== tabID && lease.expiresAt > Date.now());
    };

    const acquireLease = () => {
      if (!isVisible() || !isOnline()) {
        isLeader = false;
        return false;
      }

      const lease = readLease();
      const now = Date.now();
      if (lease && lease.tabId !== tabID && lease.expiresAt > now) {
        isLeader = false;
        return false;
      }

      announceLease({
        tabId: tabID,
        expiresAt: now + LEASE_DURATION_MS,
      });
      isLeader = true;
      return true;
    };

    const sendHeartbeat = async () => {
      if (disposed || !isVisible() || !isOnline()) return;
      if (!acquireLease()) return;

      const currentLease = readLease();
      if (!currentLease || currentLease.tabId !== tabID || currentLease.expiresAt <= Date.now()) {
        isLeader = false;
        return;
      }

      try {
        await authApi.recordActivityHeartbeat();
      } catch {
        /* no-op */
      }
    };

    const ensureTimers = () => {
      if (leaderCheckTimer === null) {
        leaderCheckTimer = window.setInterval(() => {
          if (!isVisible() || !isOnline()) return;
          if (!isLeader) {
            void acquireLease();
          }
        }, LEADER_CHECK_INTERVAL_MS);
      }

      if (heartbeatTimer === null) {
        heartbeatTimer = window.setInterval(() => {
          if (!isVisible() || !isOnline()) {
            syncEligibility();
            return;
          }
          if (isLeader || !hasActiveForeignLeader()) {
            void sendHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      }
    };

    const queueImmediateHeartbeat = () => {
      if (immediateTimer !== null) {
        window.clearTimeout(immediateTimer);
      }
      immediateTimer = window.setTimeout(() => {
        immediateTimer = null;
        void sendHeartbeat();
      }, 0);
    };

    const syncEligibility = () => {
      if (!isVisible() || !isOnline()) {
        isLeader = false;
        clearTimers();
        releaseLeaseIfOwned();
        return;
      }

      ensureTimers();
      queueImmediateHeartbeat();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LEASE_STORAGE_KEY) return;
      const lease = readLease();
      if (!lease) {
        isLeader = false;
        return;
      }
      if (lease.tabId !== tabID && lease.expiresAt > Date.now()) {
        isLeader = false;
      }
    };

    const handleBroadcast = (event: MessageEvent<{ type?: string; lease?: HeartbeatLease }>) => {
      const lease = event.data?.lease;
      if (event.data?.type !== 'lease' || !lease) return;
      if (lease.tabId !== tabID && lease.expiresAt > Date.now()) {
        isLeader = false;
      }
    };

    const handlePageStateChange = () => {
      syncEligibility();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('online', handlePageStateChange);
    window.addEventListener('offline', handlePageStateChange);
    document.addEventListener('visibilitychange', handlePageStateChange);
    window.addEventListener('beforeunload', releaseLeaseIfOwned);
    if (broadcastChannel) {
      broadcastChannel.onmessage = handleBroadcast;
    }

    syncEligibility();

    return () => {
      disposed = true;
      clearTimers();
      releaseLeaseIfOwned();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('online', handlePageStateChange);
      window.removeEventListener('offline', handlePageStateChange);
      document.removeEventListener('visibilitychange', handlePageStateChange);
      window.removeEventListener('beforeunload', releaseLeaseIfOwned);
      if (broadcastChannel) {
        broadcastChannel.onmessage = null;
        broadcastChannel.close();
      }
    };
  }, [profileQuery.data?.id]);

  return null;
}
