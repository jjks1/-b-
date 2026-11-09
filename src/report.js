/**
 * 打卡报告文本（与安卓版格式一致：抬头 / 账号 / 每项结果 / 日期）。
 */
function buildReport(res, today) {
  const head = res.success ? '✅ 今日打卡完成' : '❌ 打卡未完成';
  const lines = [head];
  if (res.uname) lines.push(`账号：${res.uname}`);
  lines.push(...(res.lines || []));
  lines.push(`日期：${today}`);
  return lines.join('\n');
}

module.exports = { buildReport };
