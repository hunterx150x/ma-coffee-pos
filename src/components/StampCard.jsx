import { rewardsAvailable } from '../../shared/pricing.js';

/** Stamp card: one cup icon per stamp toward the next free cup, plus how many free cups are ready. */
export default function StampCard({ points = 0, loyalty, compact = false, title }) {
  if (!loyalty?.enabled || !loyalty.cupsPerReward) return null;
  const per = loyalty.cupsPerReward;
  const rewards = rewardsAvailable(points, loyalty);
  const progress = Math.max(0, points) % per;
  const toNext = per - progress;
  return (
    <div className={`stamp-card ${compact ? 'stamp-card-compact' : ''} ${rewards ? 'has-reward' : ''}`}>
      {title && <div className="stamp-title">{title}</div>}
      <div className="stamp-dots" aria-label={`สะสม ${progress} จาก ${per} แก้ว`}>
        {Array.from({ length: per }, (_, i) => (
          <span key={i} className={`stamp ${i < progress ? 'on' : ''}`}>{i < progress ? '☕' : ''}</span>
        ))}
        <span className="stamp stamp-gift">🎁</span>
      </div>
      <div className="stamp-text">
        {rewards > 0 && <b className="stamp-reward">แลกฟรีได้ {rewards} แก้ว · </b>}
        <span>{points} แต้ม · อีก {toNext} แก้วรับฟรีแก้วถัดไป{loyalty.rewardMaxValue ? ` (ไม่เกิน ฿${loyalty.rewardMaxValue})` : ''}</span>
      </div>
    </div>
  );
}
