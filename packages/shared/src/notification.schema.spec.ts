import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsSchema,
  SubscribePushSchema,
  digestMessage,
  hourIn,
  inQuietHours,
} from './index.js';

describe('inQuietHours', () => {
  it('handles a window that wraps midnight, and no window', () => {
    expect(inQuietHours(23, 23, 8)).toBe(true);
    expect(inQuietHours(3, 23, 8)).toBe(true);
    expect(inQuietHours(8, 23, 8)).toBe(false);
    expect(inQuietHours(14, 23, 8)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(3, null, null)).toBe(false);
  });

  it('reads the hour in the given time zone', () => {
    expect(hourIn(new Date('2026-10-13T20:30:00Z'), 'Asia/Karachi')).toBe(1);
  });
});

describe('digestMessage', () => {
  it('leads with the count and the strongest matches', () => {
    const msg = digestMessage([
      { title: 'QA Engineer', company: 'X', score: 30, verdict: 'SKIP' },
      { title: 'React Developer', company: 'Acme', score: 84, verdict: 'APPLY' },
      { title: 'Frontend Engineer', company: 'Kwanso', score: 78, verdict: 'APPLY' },
    ]);
    expect(msg).toEqual({
      title: '3 new jobs · 2 strong matches',
      body: 'React Developer @ Acme (84), Frontend Engineer @ Kwanso (78)',
    });
  });

  it('says nothing when there is nothing new', () => {
    expect(digestMessage([])).toBeNull();
    expect(digestMessage([{ title: 'Dev', company: 'Y', score: null, verdict: null }])).toEqual({
      title: '1 new job',
      body: 'Dev @ Y',
    });
  });
});

describe('request schemas', () => {
  const keys = { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };

  it('accepts a real push subscription and refuses other endpoints or wrong key sizes', () => {
    expect(SubscribePushSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys }).success).toBe(
      true,
    );
    expect(SubscribePushSchema.safeParse({ endpoint: 'https://example.com/push', keys }).success).toBe(false);
    expect(
      SubscribePushSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'AAAA' } })
        .success,
    ).toBe(false);
  });

  it('needs both ends of quiet hours or neither', () => {
    expect(NotificationSettingsSchema.safeParse(DEFAULT_NOTIFICATION_SETTINGS).success).toBe(true);
    expect(NotificationSettingsSchema.safeParse({ ...DEFAULT_NOTIFICATION_SETTINGS, quietEnd: null }).success).toBe(
      false,
    );
  });
});
