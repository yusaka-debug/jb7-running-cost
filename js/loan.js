// ローン（元利均等・毎月返済）の返済予定と残高の計算
// 乗り物の設定 extra.loan に保存する:
// { lender, product, amount, startDate, firstPayDate, count, payDay, rateType, note,
//   firstPayment,                         // 第1回の返済額（日割り利息のため他の回と違う）
//   rates: [{ fromNo, rate, payment, note }],   // 第fromNo回から適用する年利(%)と毎月の返済額
//   anchors: [{ no, balance, note }],           // 第no回の返済後の残高（返済予定表に書かれた確かな値）
//   files: [{ id, name, mime, size, driveId }] }   // 融資計算書・返済予定表などの PDF

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

/** 第n回の返済日（毎月 payDay 日。月末を超える日は月末） */
export function payDate(loan, n) {
  const [y, m] = loan.firstPayDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (n - 1), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(Number(loan.payDay) || Number(loan.firstPayDate.slice(8, 10)), last));
  return ymd(d);
}

const rateAt = (loan, n) => {
  const list = [...(loan.rates || [])].filter(r => Number(r.fromNo) <= n).sort((a, b) => a.fromNo - b.fromNo);
  return list[list.length - 1] || { rate: 0, payment: 0 };
};

/** 全回の返済予定 [{no, date, payment, principal, interest, balance, rate, sure}] */
export function loanSchedule(loan) {
  if (!loan?.amount || !loan.count || !loan.firstPayDate) return [];
  const anchors = new Map((loan.anchors || []).map(a => [Number(a.no), Number(a.balance)]));
  const lastAnchor = Math.max(0, ...anchors.keys());
  let bal = Number(loan.amount);
  const rows = [];
  for (let n = 1; n <= loan.count; n++) {
    if (anchors.has(n - 1)) bal = anchors.get(n - 1);
    if (bal <= 0) break;
    const { rate, payment } = rateAt(loan, n);
    const r = Number(rate) / 100;
    let interest = n === 1 && loan.startDate
      ? Math.floor(bal * r * (daysBetween(loan.startDate, payDate(loan, 1)) + 1) / 365)   // 初回は日割り
      : Math.floor(bal * r / 12);
    let pay = n === 1 && loan.firstPayment ? Number(loan.firstPayment) : Number(payment);
    let principal = pay - interest;
    if (n === Number(loan.count) || principal >= bal) { principal = bal; pay = principal + interest; }
    bal -= principal;
    if (anchors.has(n)) bal = anchors.get(n);
    rows.push({ no: n, date: payDate(loan, n), payment: pay, principal, interest, balance: bal, rate: Number(rate), sure: n >= lastAnchor || anchors.has(n) });
  }
  return rows;
}

/** 今日時点の状況 */
export function loanStatus(loan, today) {
  const rows = loanSchedule(loan);
  if (!rows.length) return null;
  const paid = rows.filter(r => r.date <= today);
  const rest = rows.filter(r => r.date > today);
  const last = paid[paid.length - 1];
  const balance = last ? last.balance : Number(loan.amount);
  const next = rest[0] || null;
  const months = rest.length;
  return {
    rows, paidCount: paid.length, restCount: months, balance,
    principalPaid: Number(loan.amount) - balance,
    progress: Math.min(1, (Number(loan.amount) - balance) / Number(loan.amount)),
    years: Math.floor(months / 12), months: months % 12,
    next, finalDate: rows[rows.length - 1].date,
    restPayments: rest.reduce((a, r) => a + r.payment, 0),
    restInterest: rest.reduce((a, r) => a + r.interest, 0),
    rate: (next || last).rate, payment: next ? next.payment : 0,
  };
}

/** 「約372万円」 */
export const manYen = n => n >= 10000 ? `約${Math.round(n / 10000).toLocaleString('ja-JP')}万円` : `${Math.round(n).toLocaleString('ja-JP')}円`;
