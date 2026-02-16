/**
 * PDUFA Date Parser
 * Extracts PDUFA dates, drug names, and submission types from SEC filing text
 */

// Month names for parsing
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const MONTH_MAP = MONTHS.reduce((acc, month, i) => {
  acc[month] = i + 1;
  acc[month.substring(0, 3)] = i + 1; // Also match abbreviated forms
  return acc;
}, {});

/**
 * Patterns for extracting PDUFA dates
 */
const PDUFA_PATTERNS = [
  // "PDUFA date of March 15, 2025"
  /PDUFA\s*(?:target\s*)?date\s*(?:of\s*)?(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/gi,

  // "PDUFA date is March 15, 2025"
  /PDUFA\s*(?:target\s*)?date\s*(?:is|was|will be)\s*(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/gi,

  // "PDUFA date: March 15, 2025" or "PDUFA date - March 15, 2025"
  /PDUFA\s*(?:target\s*)?date\s*[:\-]\s*(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/gi,

  // "PDUFA goal date of Q1 2025" (quarterly format)
  /PDUFA\s*(?:target\s*|goal\s*)?date\s*(?:of\s*|is\s*|in\s*)?(Q[1-4])\s+(\d{4})/gi,

  // "action date of March 15, 2025"
  /(?:FDA\s*)?action\s*date\s*(?:of\s*|is\s*)?(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/gi,

  // "target action date is March 2025" (month + year only)
  /(?:PDUFA|target\s*action)\s*date\s*(?:is|of)?\s*(\w+)\s+(\d{4})/gi,

  // "expected FDA decision by March 2025"
  /(?:expected|anticipate[ds]?)\s*(?:FDA\s*)?(?:decision|approval)\s*(?:by|in)\s*(\w+)\s+(\d{4})/gi,

  // Dates like "March 15, 2025 PDUFA date"
  /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*PDUFA\s*(?:target\s*)?date/gi
];

/**
 * Patterns for submission type
 */
const SUBMISSION_PATTERNS = [
  // "submitted an NDA", "filed a BLA"
  /(?:submitted|filed|submit|file)\s+(?:an?\s+)?(\w?NDA|\w?BLA)/gi,

  // "NDA submission", "BLA filing"
  /(\w?NDA|\w?BLA)\s+(?:submission|filing|application)/gi,

  // "sNDA for...", "sBLA for..."
  /(sNDA|sBLA)\s+(?:for|seeking|to)/gi,

  // "New Drug Application", "Biologics License Application"
  /(New\s+Drug\s+Application|Biologics?\s+License\s+Application)/gi
];

/**
 * Patterns for drug/product names
 */
const DRUG_NAME_PATTERNS = [
  // "(drug_name)" in parentheses after generic name
  /(\w+(?:\s+\w+)?)\s*\(([^)]+)\)/g,

  // Code names like "ABC-123" or "XYZ1234"
  /\b([A-Z]{2,5}[-\s]?\d{3,6}[A-Z]?)\b/g,

  // Generic drug names ending in common suffixes
  /\b([a-z]+(?:mab|nib|tinib|ciclib|statin|parin|zole|vir|ib|ab))\b/gi
];

/**
 * Patterns for approval status
 */
const APPROVAL_STATUS_PATTERNS = [
  // FDA approved
  /FDA\s+(?:has\s+)?approv(?:ed|al)\s+(?:of\s+)?([^.]+)/gi,

  // Complete Response Letter
  /(?:received|issued)\s+(?:a\s+)?Complete\s+Response\s+Letter/gi,

  // CRL
  /\bCRL\b/g,

  // Advisory committee vote
  /advisory\s+committee\s+(?:voted|recommended|supported)/gi
];

/**
 * Parse a date string and return ISO date
 */
function parseDate(monthStr, dayStr, yearStr) {
  const month = MONTH_MAP[monthStr?.toLowerCase()];
  if (!month) return null;

  const day = parseInt(dayStr) || 15; // Default to mid-month if no day
  const year = parseInt(yearStr);

  if (!year || year < 2020 || year > 2035) return null;

  // Format as ISO date
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse quarterly date (Q1 2025 -> 2025-03-15)
 */
function parseQuarterlyDate(quarter, year) {
  const quarterEndMonths = { Q1: 3, Q2: 6, Q3: 9, Q4: 12 };
  const month = quarterEndMonths[quarter.toUpperCase()];
  if (!month) return null;

  const yearNum = parseInt(year);
  if (!yearNum || yearNum < 2020 || yearNum > 2035) return null;

  // Use last day of quarter
  const lastDay = month === 3 || month === 6 || month === 9 ? 30 : 31;
  return `${yearNum}-${String(month).padStart(2, '0')}-${lastDay}`;
}

/**
 * Extract PDUFA dates from text
 */
function extractPDUFADates(text) {
  if (!text) return [];

  const dates = [];
  const seen = new Set();

  for (const pattern of PDUFA_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      let date = null;

      if (match[1]?.startsWith('Q')) {
        // Quarterly format
        date = parseQuarterlyDate(match[1], match[2]);
      } else if (match[3]) {
        // Full date with month, day, year
        date = parseDate(match[1], match[2], match[3]);
      } else if (match[2] && !match[3]) {
        // Month + year only
        date = parseDate(match[1], '15', match[2]);
      }

      if (date && !seen.has(date)) {
        seen.add(date);
        dates.push({
          date,
          context: text.substring(
            Math.max(0, match.index - 100),
            Math.min(text.length, match.index + match[0].length + 100)
          ).trim()
        });
      }
    }
  }

  return dates;
}

/**
 * Extract submission type from text
 */
function extractSubmissionType(text) {
  if (!text) return null;

  for (const pattern of SUBMISSION_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const type = match[1].toUpperCase();

      // Normalize submission types
      if (type.includes('NDA')) {
        return type.startsWith('S') ? 'sNDA' : 'NDA';
      }
      if (type.includes('BLA')) {
        return type.startsWith('S') ? 'sBLA' : 'BLA';
      }
      if (type.includes('NEW DRUG')) return 'NDA';
      if (type.includes('BIOLOGIC')) return 'BLA';
    }
  }

  return null;
}

/**
 * Extract drug names from text
 */
function extractDrugNames(text) {
  if (!text) return [];

  const drugs = new Set();

  for (const pattern of DRUG_NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Add both the generic name and any brand name in parentheses
      if (match[1]) drugs.add(match[1].trim());
      if (match[2]) drugs.add(match[2].trim());
    }
  }

  // Filter out common false positives
  const filtered = Array.from(drugs).filter(drug => {
    const lower = drug.toLowerCase();
    return (
      drug.length >= 3 &&
      drug.length <= 50 &&
      !/^(the|and|for|with|from|this|that|has|was|were|are|been|have|will|can|may|should|would|could)$/i.test(drug) &&
      !/^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(drug) &&
      !/^\d+$/.test(drug) // Not just numbers
    );
  });

  return filtered;
}

/**
 * Extract approval status from text
 */
function extractApprovalStatus(text) {
  if (!text) return 'Pending';

  const textLower = text.toLowerCase();

  // Check for CRL (complete response letter)
  if (textLower.includes('complete response letter') || /\bCRL\b/.test(text)) {
    return 'CRL';
  }

  // Check for approval
  if (textLower.includes('fda approved') || textLower.includes('fda has approved')) {
    return 'Approved';
  }

  // Check for rejection/refusal
  if (textLower.includes('refused to file') || textLower.includes('rejection')) {
    return 'Rejected';
  }

  // Check for withdrawal
  if (textLower.includes('withdrawn') || textLower.includes('withdrew')) {
    return 'Withdrawn';
  }

  return 'Pending';
}

/**
 * Extract indication/disease from text near drug mention
 */
function extractIndication(text, drugName) {
  if (!text || !drugName) return null;

  // Look for patterns like "for the treatment of X" or "to treat X"
  const indicationPatterns = [
    new RegExp(`${drugName}[^.]*?(?:for\\s+(?:the\\s+)?treatment\\s+of|to\\s+treat|indicated\\s+for)\\s+([^,.]+)`, 'i'),
    new RegExp(`(?:for\\s+(?:the\\s+)?treatment\\s+of|to\\s+treat)\\s+([^,.]+)[^.]*?${drugName}`, 'i'),
    new RegExp(`${drugName}[^.]*?(?:in\\s+patients\\s+with)\\s+([^,.]+)`, 'i')
  ];

  for (const pattern of indicationPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Parse a full filing text and extract all catalyst information
 */
function parseFilingForCatalysts(text, companyName = null) {
  if (!text) return null;

  const pdufaDates = extractPDUFADates(text);
  const submissionType = extractSubmissionType(text);
  const drugNames = extractDrugNames(text);
  const status = extractApprovalStatus(text);

  // If we found PDUFA dates, return catalyst info
  if (pdufaDates.length > 0 || drugNames.length > 0) {
    // Try to extract indication for each drug
    const drugsWithIndications = drugNames.map(drug => ({
      name: drug,
      indication: extractIndication(text, drug)
    }));

    return {
      pdufaDates,
      submissionType,
      drugs: drugsWithIndications,
      status,
      company: companyName
    };
  }

  return null;
}

module.exports = {
  extractPDUFADates,
  extractSubmissionType,
  extractDrugNames,
  extractApprovalStatus,
  extractIndication,
  parseFilingForCatalysts,
  parseDate,
  parseQuarterlyDate
};
