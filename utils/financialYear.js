/**
 * Financial year: June to June (e.g. 2025-26 = June 2025 to May 2026).
 * Used for crops, reports, and farmer comparison.
 */

/**
 * Get financial year string from a date.
 * FY runs June 1 (startYear) to May 31 (startYear+1).
 * @param {Date} [date=new Date()]
 * @returns {string} e.g. "2025-26"
 */
function getFinancialYearFromDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed: Jan=0, Jun=5
  if (month >= 5) {
    // June (5) onwards -> current year starts FY
    const endYear = (year + 1) % 100;
    return `${year}-${String(endYear).padStart(2, "0")}`;
  }
  // Jan-May -> previous year starts FY
  const startYear = year - 1;
  const endYear = year % 100;
  return `${startYear}-${String(endYear).padStart(2, "0")}`;
}

/**
 * Parse "2025-26" to start and end dates (June 1 2025 - May 31 2026).
 * @param {string} financialYear e.g. "2025-26"
 * @returns {{ startDate: string, endDate: string }} ISO date strings (DATEONLY)
 */
function parseFinancialYear(financialYear) {
  if (!financialYear || typeof financialYear !== "string") return null;
  const match = financialYear.trim().match(/^(\d{4})-(\d{2})$/) || financialYear.trim().match(/^(\d{4})-(\d{2,4})$/);
  if (!match) return null;
  const startYear = parseInt(match[1], 10);
  const endPart = match[2].length === 2 ? parseInt(match[2], 10) : parseInt(match[2], 10) % 100;
  const endYear = endPart < 50 ? startYear + 1 : startYear + 1; // 26 -> 2026
  const endYearFull = startYear + 1;
  return {
    startDate: `${startYear}-06-01`,
    endDate: `${endYearFull}-05-31`,
  };
}

/**
 * List of financial year strings for pickers (e.g. last 3 and next 1).
 * @param {number} [before=2] how many years before current
 * @param {number} [after=1] how many years after current
 * @returns {string[]} e.g. ["2023-24", "2024-25", "2025-26", "2026-27"]
 */
function getFinancialYearOptions(before = 2, after = 1) {
  const current = getFinancialYearFromDate();
  const [startY] = current.split("-").map(Number);
  const result = [];
  for (let i = -before; i <= after; i++) {
    const y = startY + i;
    const end = (y + 1) % 100;
    result.push(`${y}-${String(end).padStart(2, "0")}`);
  }
  return result;
}

/**
 * Sort financial year strings (newest first).
 * @param {string[]} years
 * @returns {string[]}
 */
function sortFinancialYearsDesc(years) {
  return [...years].sort((a, b) => {
    const [aStart] = a.split("-").map(Number);
    const [bStart] = b.split("-").map(Number);
    return bStart - aStart;
  });
}

module.exports = {
  getFinancialYearFromDate,
  parseFinancialYear,
  getFinancialYearOptions,
  sortFinancialYearsDesc,
};
