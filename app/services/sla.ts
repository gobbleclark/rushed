/**
 * SLA (Service Level Agreement) logic for Priority Handling
 */

export interface SLAInfo {
  hours: number;
  cutoffTime: string;
  isAvailable: boolean;
  message: string;
}

/**
 * Calculate SLA based on current time and 8PM EST cutoff
 */
export function calculateSLA(timezone: string = 'America/New_York'): SLAInfo {
  const now = new Date();
  
  // Convert to EST/EDT
  const estTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const currentHour = estTime.getHours();
  
  // Check if it's before 8PM EST (20:00)
  const isBeforeCutoff = currentHour < 20;
  
  if (isBeforeCutoff) {
    return {
      hours: 3,
      cutoffTime: '8:00 PM EST',
      isAvailable: true,
      message: 'Order will be picked and packed within 3 hours (before 8PM EST cutoff)',
    };
  } else {
    // After 8PM, orders will be processed next business day
    return {
      hours: 24, // Next business day
      cutoffTime: '8:00 PM EST',
      isAvailable: false,
      message: 'Priority handling not available after 8PM EST. Orders placed now will be processed next business day.',
    };
  }
}

/**
 * Get SLA message for customer display
 */
export function getSLAMessage(timezone: string = 'America/New_York'): string {
  const sla = calculateSLA(timezone);
  
  if (sla.isAvailable) {
    return `We'll pick and pack your order within ${sla.hours} hours (orders placed before ${sla.cutoffTime})`;
  } else {
    return `Priority handling available tomorrow. Orders placed after ${sla.cutoffTime} will be processed next business day.`;
  }
}

/**
 * Check if priority handling is currently available
 */
export function isPriorityHandlingAvailable(timezone: string = 'America/New_York'): boolean {
  return calculateSLA(timezone).isAvailable;
}

/**
 * Get the current SLA hours based on time
 */
export function getCurrentSLAHours(timezone: string = 'America/New_York'): number {
  return calculateSLA(timezone).hours;
}

/**
 * Format time remaining until cutoff
 */
export function getTimeUntilCutoff(timezone: string = 'America/New_York'): string {
  const now = new Date();
  const estTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  
  // Set cutoff to 8PM today
  const cutoff = new Date(estTime);
  cutoff.setHours(20, 0, 0, 0);
  
  // If cutoff has passed, set to next day
  if (estTime > cutoff) {
    cutoff.setDate(cutoff.getDate() + 1);
  }
  
  const diffMs = cutoff.getTime() - estTime.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes}m until cutoff`;
  } else {
    return `${diffMinutes}m until cutoff`;
  }
}

/**
 * Generate priority handling note with SLA info
 */
export function generatePriorityNote(timezone: string = 'America/New_York'): string {
  const sla = calculateSLA(timezone);
  
  if (sla.isAvailable) {
    return `[PRIORITY] Skip-the-line purchased. SLA: ${sla.hours} hrs (before ${sla.cutoffTime}).`;
  } else {
    return `[PRIORITY] Skip-the-line purchased. Processing: Next business day (after ${sla.cutoffTime}).`;
  }
}
