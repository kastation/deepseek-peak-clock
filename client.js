window.__ModuleLoader__.load({
  id: '@local/deepseek-peak-clock',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'deepseek-peak-clock';

    /** Captured in apply(); the per-session composer-block registry. */
    let conversationBlocks = null;

    /** Text dictionary; the slot's `t` seat resolves against the active locale. */
    const en = {
      'label.localTime': 'Local time',
      'label.peakIn': 'Peak in',
      'label.offPeakIn': 'Off-peak in',
      'label.nextChange': 'Next change',
      'label.zone': 'Local time zone',
      'status.peak': 'Peak',
      'status.offPeak': 'Off-peak',
      'tooltip.schedule': 'DeepSeek API peak hours: Mon–Fri 01:00–04:00 and 06:00–10:00 UTC.',
      'tooltip.offPeak': 'Off-peak: all other hours, including weekends and Chinese public holidays.',
      'tooltip.holidays': 'Holiday calendar bundled: 2026 Chinese public holidays.',
      'guard.label': 'Block send',
      'guard.aria': 'Block sending during DeepSeek peak hours',
      'guard.tooltip': 'On: the composer is locked during DeepSeek peak hours. Turn it off to compose and send; it re-locks 60 seconds later.',
      'guard.blockReason': 'DeepSeek peak rates are active. Turn off “Block send” below the composer to send.',
    };
    const zh = {
      'label.localTime': '本地时间',
      'label.peakIn': '距高峰还有',
      'label.offPeakIn': '距低谷还有',
      'label.nextChange': '下次切换',
      'label.zone': '本地时区',
      'status.peak': '高峰',
      'status.offPeak': '低谷',
      'tooltip.schedule': 'DeepSeek API 高峰时段：周一至周五 UTC 01:00–04:00 与 06:00–10:00。',
      'tooltip.offPeak': '低谷时段：其余时间，包括周末与中国法定节假日。',
      'tooltip.holidays': '已内置节假日日历：2026 年中国法定节假日。',
      'guard.label': '阻止发送',
      'guard.aria': '在 DeepSeek 高峰时段阻止发送',
      'guard.tooltip': '开启时，DeepSeek 高峰时段输入框会被锁定；关闭后可输入和发送，60 秒后会再次锁定。',
      'guard.blockReason': 'DeepSeek 高峰计费中。关闭输入框下方的“阻止发送”后即可输入和发送。',
    };

    /*
     * DeepSeek API rate windows, in UTC. Source:
     * https://api-docs.deepseek.com/quick_start/pricing
     * "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through
     * Friday, excluding Chinese public holidays."
     * Both windows fall on the same Beijing calendar date as their UTC date
     * (09:00-12:00 and 14:00-18:00 Beijing), so a UTC date key is enough for
     * the holiday lookup.
     */
    const PEAK_WINDOWS_UTC = [[1, 4], [6, 10]];
    const PEAK_BOUNDARIES_UTC = [1, 4, 6, 10];

    /*
     * Chinese public holidays for 2026, from the State Council notice
     * 国办发明电〔2025〕7号 (published 2025-11-04):
     * https://www.gov.cn/zhengce/content/202511/content_7047090.htm
     * Extend this table when the notice for the next year is published. The
     * make-up working weekends in that notice stay off-peak here: the API
     * rule names Monday through Friday, not "official working days".
     */
    const CHINESE_HOLIDAY_RANGES_2026 = [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
    ];

    const CHINESE_HOLIDAYS = (() => {
      const dates = new Set();
      for (const [start, end] of CHINESE_HOLIDAY_RANGES_2026) {
        const from = Date.parse(`${start}T00:00:00Z`);
        const to = Date.parse(`${end}T00:00:00Z`);
        for (let at = from; at <= to; at += 86400000) {
          dates.add(new Date(at).toISOString().slice(0, 10));
        }
      }
      return dates;
    })();

    const pad2 = (value) => String(value).padStart(2, '0');

    /** UTC calendar key (YYYY-MM-DD) for the date containing `date`. */
    function utcDateKey(date) {
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    }

    /** True while DeepSeek bills the peak rate at the instant `ms`. */
    function isPeakAt(ms) {
      const date = new Date(ms);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      if (CHINESE_HOLIDAYS.has(utcDateKey(date))) return false;
      const hours = date.getUTCHours() + date.getUTCMinutes() / 60
        + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;
      return PEAK_WINDOWS_UTC.some(([start, end]) => hours >= start && hours < end);
    }

    /**
     * Start of the peak window containing `ms`, or null while off-peak.
     * This timestamp is the guard's arm identity: a new window re-arms it.
     */
    function peakWindowStart(ms) {
      if (!isPeakAt(ms)) return null;
      const date = new Date(ms);
      const hours = date.getUTCHours() + date.getUTCMinutes() / 60
        + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;
      const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      for (const [start, end] of PEAK_WINDOWS_UTC) {
        if (hours >= start && hours < end) return dayStart + start * 3600000;
      }
      return null;
    }

    /**
     * First UTC boundary after `ms` whose rate differs from the current one.
     * Rate changes only at a window edge, so scanning a fortnight of edges is
     * enough to cross the longest weekend/holiday gap.
     * @returns {{ at: number, toPeak: boolean } | null}
     */
    function nextRateChange(ms) {
      const peak = isPeakAt(ms);
      const now = new Date(ms);
      const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      for (let offset = 0; offset <= 14; offset += 1) {
        for (const hour of PEAK_BOUNDARIES_UTC) {
          const at = dayStart + offset * 86400000 + hour * 3600000;
          if (at <= ms) continue;
          if (isPeakAt(at) !== peak) return { at, toPeak: !peak };
        }
      }
      return null;
    }

    /** Compact countdown: `MM:SS`, `H:MM:SS`, or `Xd HH:MM:SS`. */
    function formatCountdown(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (days > 0) return `${days}d ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
      if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
      return `${pad2(minutes)}:${pad2(seconds)}`;
    }

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const zoneFormatter = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
    const momentFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const zoneLong = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function zoneName(date) {
      const part = zoneFormatter.formatToParts(date).find((entry) => entry.type === 'timeZoneName');
      return part === undefined ? '' : part.value;
    }

    const clockGlyph = h('svg', {
      className: 'dskpc-glyph',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      focusable: 'false',
    },
      h('circle', {
        cx: 8,
        cy: 8,
        r: 6.25,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
      }),
      h('path', {
        d: 'M8 4.75V8l2.25 1.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }));

    function PeakClock({ t, sessionId }) {
      const tr = typeof t === 'function' ? t : (key) => en[key] ?? key;
      const [now, setNow] = React.useState(() => Date.now());
      const [guardNow, setGuardNow] = React.useState(() => Date.now());
      const [guardOn, setGuardOn] = React.useState(true);
      const lastPeakStart = React.useRef(null);
      const rearmTimer = React.useRef(null);

      function clearRearm() {
        if (rearmTimer.current !== null) {
          clearTimeout(rearmTimer.current);
          rearmTimer.current = null;
        }
      }

      React.useEffect(() => {
        let timer;
        const tick = () => {
          setNow(Date.now());
          timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
        };
        timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
        return () => clearTimeout(timer);
      }, []);

      /*
       * The guard decision is re-evaluated once a minute, on the minute
       * boundary, so a peak transition is applied even when the tab was idle.
       * This is deliberately separate from the one-second display clock.
       */
      React.useEffect(() => {
        let timer;
        const check = () => {
          const at = Date.now();
          setGuardNow(at);
          // Re-arm on the minute check only when no 60-second override is
          // already counting down; the override owns the exact unlock window.
          if (isPeakAt(at) && rearmTimer.current === null) setGuardOn(true);
          timer = setTimeout(check, 60000 - (Date.now() % 60000) + 25);
        };
        timer = setTimeout(check, 60000 - (Date.now() % 60000) + 25);
        return () => clearTimeout(timer);
      }, []);

      const guardPeak = isPeakAt(guardNow);
      const guardPeakStart = peakWindowStart(guardNow);

      /*
       * Arm the guard at the start of every peak window, and clear any
       * override left over from the previous one.
       */
      React.useEffect(() => {
        if (guardPeakStart !== null && guardPeakStart !== lastPeakStart.current) {
          clearRearm();
          setGuardOn(true);
        }
        lastPeakStart.current = guardPeakStart;
      }, [guardPeakStart]);

      /*
       * Turning the guard off is a 60-second override: it re-locks by itself
       * if the peak window is still active when the timer fires. Turning it
       * back on manually cancels the override.
       */
      function toggleGuard() {
        if (guardOn) {
          setGuardOn(false);
          clearRearm();
          rearmTimer.current = setTimeout(() => {
            rearmTimer.current = null;
            if (isPeakAt(Date.now())) setGuardOn(true);
          }, 60000);
        } else {
          setGuardOn(true);
          clearRearm();
        }
      }

      React.useEffect(() => () => clearRearm(), []);

      React.useEffect(() => {
        if (!guardPeak) clearRearm();
      }, [guardPeak]);

      /*
       * A composer block is the supported way for one plugin to stop a
       * session's input. The registry is one block per session, so only clear
       * the block when its reason is still ours.
       */
      const blockReason = tr('guard.blockReason');
      React.useEffect(() => {
        if (sessionId === undefined || conversationBlocks === null) return undefined;
        if (guardPeak && guardOn) {
          conversationBlocks.set(sessionId, { reason: blockReason });
          return () => {
            const current = conversationBlocks.storeFor(sessionId).getSnapshot();
            if (current !== undefined && current.reason === blockReason) {
              conversationBlocks.set(sessionId, undefined);
            }
          };
        }
        const current = conversationBlocks.storeFor(sessionId).getSnapshot();
        if (current !== undefined && current.reason === blockReason) {
          conversationBlocks.set(sessionId, undefined);
        }
        return undefined;
      }, [sessionId, guardPeak, guardOn, blockReason]);

      const date = new Date(now);
      const peak = isPeakAt(now);
      const change = nextRateChange(now);
      const zone = zoneName(date);
      const timeText = timeFormatter.format(date);
      const countdown = change === null ? '' : formatCountdown(change.at - now);
      const nextLabel = change === null ? '' : tr(change.toPeak ? 'label.peakIn' : 'label.offPeakIn');
      const statusLabel = tr(peak ? 'status.peak' : 'status.offPeak');

      const tooltip = [
        tr('tooltip.schedule'),
        tr('tooltip.offPeak'),
        tr('tooltip.holidays'),
        `${tr('label.zone')}: ${zoneLong}`,
        ...(change === null ? [] : [`${tr('label.nextChange')}: ${momentFormatter.format(new Date(change.at))}`]),
      ].join('\n');

      const aria = [
        `${tr('label.localTime')} ${timeText}${zone === '' ? '' : ` ${zone}`}`,
        statusLabel,
        ...(countdown === '' ? [] : [`${nextLabel} ${countdown}`]),
      ].join('. ');

      return h('span', {
        className: 'dskpc-root',
        title: tooltip,
        'aria-label': aria,
      },
        clockGlyph,
        h('span', { className: 'dskpc-time' }, timeText),
        zone === '' ? null : h('span', { className: 'dskpc-zone' }, zone),
        h('span', { className: 'dskpc-sep', 'aria-hidden': true }),
        h('span', {
          className: `dskpc-dot ${peak ? 'dskpc-dot--peak' : 'dskpc-dot--off'}`,
          'aria-hidden': true,
        }),
        h('span', {
          className: `dskpc-status ${peak ? 'dskpc-status--peak' : 'dskpc-status--off'}`,
        }, statusLabel),
        countdown === '' ? null : h('span', { className: 'dskpc-count' }, `${nextLabel} ${countdown}`),
        guardPeak ? h('span', { className: 'dskpc-guard' },
          h('span', { className: 'dskpc-sep', 'aria-hidden': true }),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': guardOn,
            'aria-label': tr('guard.aria'),
            title: tr('guard.tooltip'),
            className: 'dskpc-guard-button',
            onClick: () => setGuardOn((value) => !value),
          },
            h('span', {
              className: `dskpc-switch${guardOn ? ' is-on' : ''}`,
              'aria-hidden': true,
            }, h('span', { className: 'dskpc-switch-thumb' })),
            h('span', { className: 'dskpc-guard-label' }, tr('guard.label')))) : null);
    }

    const css = `
.dskpc-root {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px 7px;
  min-width: 0;
  max-width: 100%;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: none;
}
.dskpc-glyph {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
}
.dskpc-time {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dskpc-zone {
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.dskpc-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: var(--dsw-alias-border-l1);
}
.dskpc-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.dskpc-dot--peak {
  background: var(--dsw-alias-state-warn-primary);
}
.dskpc-dot--off {
  background: var(--dsw-alias-state-success-primary);
}
.dskpc-status {
  font-weight: 500;
}
.dskpc-status--peak {
  color: var(--dsw-alias-state-warn-primary);
}
.dskpc-status--off {
  color: var(--dsw-alias-state-success-primary);
}
.dskpc-count {
  color: var(--dsw-alias-label-tertiary);
}
.dskpc-guard {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.dskpc-guard-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.dskpc-guard-button:hover {
  color: var(--dsw-alias-label-primary);
}
.dskpc-guard-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dskpc-guard-label {
  color: inherit;
}
.dskpc-switch {
  position: relative;
  flex: none;
  width: 26px;
  height: 16px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
  transition: background-color 0.16s ease;
}
.dskpc-switch.is-on {
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-warn-primary);
}
.dskpc-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l1);
  transition: transform 0.16s ease;
}
.dskpc-switch.is-on .dskpc-switch-thumb {
  transform: translateX(10px);
}
@media (prefers-reduced-motion: reduce) {
  .dskpc-switch,
  .dskpc-switch-thumb {
    transition: none;
  }
}
@media (max-width: 560px) {
  .dskpc-zone,
  .dskpc-sep {
    display: none;
  }
}
`;

    function apply(ctx) {
      conversationBlocks = ctx.conversation.blocks;
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'deepseek-peak-clock: dictionaries');
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/deepseek-peak-clock';
        tag.dataset.pluginCss = '@local/deepseek-peak-clock/clock.css';
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'deepseek-peak-clock: styles');
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'deepseek-peak-clock',
        order: 3,
        locale: NS,
      }, PeakClock));
    }

    return {
      inject: ['slots', 'locale', 'conversation'],
      apply,
    };
  },
});
