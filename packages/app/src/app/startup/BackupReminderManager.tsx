import { useMemo, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useProfile } from '@entities/user/api/useAuth';
import { useActiveSpace } from '@shared/runtime/runtime-provider';
import { useQueryClient } from '@tanstack/react-query';

import BackupReminderDialog from '@app/system/BackupReminderDialog';
import type { User } from '@shared/model/auth';

import { isRecoveryRoute } from './policy';

export function BackupReminderManager() {
  const location = useLocation();
  const profileQuery = useProfile();
  const profile = profileQuery.data;
  const activeSpace = useActiveSpace();
  const queryClient = useQueryClient();
  const [backupCompleted, setBackupCompleted] = useState(false);
  const [renderedAt] = useState(() => Date.now());

  const isOwner = !activeSpace || activeSpace.role === 'owner';
  const profileReady = useMemo(() => {
    return Boolean(profile?.id) && !profileQuery.isLoading && !profileQuery.isFetching;
  }, [profile?.id, profileQuery.isFetching, profileQuery.isLoading]);

  const frequencyDays = useMemo(() => {
    return Math.max(1, profile?.backup_reminder_frequency_days ?? 7);
  }, [profile?.backup_reminder_frequency_days]);

  const lastBackupTime = useMemo(() => {
    return profile?.last_user_db_backup ? Date.parse(profile.last_user_db_backup) : NaN;
  }, [profile?.last_user_db_backup]);

  const needsBackup = useMemo(() => {
    if (!profileReady || !isOwner || backupCompleted || isRecoveryRoute(location.pathname)) {
      return false;
    }

    const createdAtMs = profile?.created_at ? Date.parse(profile.created_at) : NaN;
    const gracePeriodMs = frequencyDays * 24 * 60 * 60 * 1000;
    if (createdAtMs && !Number.isNaN(createdAtMs) && renderedAt - createdAtMs < gracePeriodMs) {
      return false;
    }

    if (!lastBackupTime || Number.isNaN(lastBackupTime)) {
      return true;
    }

    return renderedAt - lastBackupTime > frequencyDays * 24 * 60 * 60 * 1000;
  }, [
    backupCompleted,
    frequencyDays,
    isOwner,
    lastBackupTime,
    location.pathname,
    profile?.created_at,
    profileReady,
    renderedAt,
  ]);

  const handleRecorded = useCallback(
    (timestamp: string) => {
      setBackupCompleted(true);
      queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
        if (!prev) return prev;
        return { ...prev, last_user_db_backup: timestamp };
      });
    },
    [queryClient]
  );

  if (!needsBackup) return null;

  return <BackupReminderDialog open blockClose={false} onBackupRecorded={handleRecorded} />;
}

export default BackupReminderManager;
