/**
 * H4 Billing ERP - Calculation Engine
 * Pure calculation engine for invoices and quotations
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * calculation-engine.js handles ALL financial calculations:
 * - Item totals (Quantity × Rate)
 * - Subtotal
 * - Discount (Invoice-level only)
 * - Taxable Amount
 * - GST (Invoice-level only)
 * - CGST / SGST / IGST
 * - Total GST
 * - Round Off (with configurable modes)
 * - Grand Total
 * 
 * ============================================================
 * RULES
 * ============================================================
 * 
 * 1. GST is Invoice-level ONLY - No item-level GST
 * 2. Discount is Invoice-level ONLY - No item-level discount
 * 3. GST rates: Only configured rates are accepted
 * 4. GST rates: [0, 5, 7, 9, 18, 28]
 * 5. Intra-state → CGST + SGST (half each)
 * 6. Inter-state → IGST (full amount)
 * 7. GST disabled → All GST = 0
 * 8. Round off modes: none, nearest, up, down, nearest-5, nearest-10
 * 
 * ============================================================
 * ROUND OFF MODES
 * ============================================================
 * 
 * 'none'        → No rounding, keep as is
 * 'nearest'     → Round to nearest value (0.5 rounds up)
 * 'up'          → Round up (ceiling)
 * 'down'        → Round down (floor)
 * 'nearest-5'   → Round to nearest 5
 * 'nearest-10'  → Round to nearest 10
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT access IndexedDB
 * - Does NOT access database
 * - Does NOT contain UI logic
 * - Does NOT contain business logic
 * - Does NOT generate PDF/Print/WhatsApp
 * - Does NOT read Product Master GST
 * - Does NOT handle item-level discount
 * - Does NOT handle item-level GST
 * ============================================================
 */

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_GST_RATES = [0, 5, 7, 9, 18, 28];
const DISCOUNT_TYPES = ['none', 'percentage', 'flat'];
const GST_TYPES = ['intra', 'inter'];
const ROUNDING_MODES = ['none', 'nearest', 'up', 'down', 'nearest-5', 'nearest-10'];

const DEFAULT_ROUNDING_MODE = 'nearest';
const DEFAULT_ROUNDING_PRECISION = 0; // 0 = whole numbers (₹), 2 = paise

// ============================================================
// CALCULATION ENGINE CLASS
// ============================================================

class CalculationEngine {
    constructor() {
        this._roundingMode = DEFAULT_ROUNDING_MODE;
        this._roundingPrecision = DEFAULT_ROUNDING_PRECISION;
        this._gstRates = [...DEFAULT_GST_RATES];
    }

    // ============================================================
    // CONFIGURATION
    // ============================================================

    /**
     * Set rounding mode
     * @param {string} mode - 'none', 'nearest', 'up', 'down', 'nearest-5', 'nearest-10'
     */
    setRoundingMode(mode) {
        if (ROUNDING_MODES.includes(mode)) {
            this._roundingMode = mode;
        } else {
            throw new Error(`Invalid rounding mode: ${mode}. Available: ${ROUNDING_MODES.join(', ')}`);
        }
    }

    /**
     * Set rounding precision
     * @param {number} precision - Number of decimal places (0 for whole numbers)
     */
    setRoundingPrecision(precision) {
        if (typeof precision === 'number' && precision >= 0) {
            this._roundingPrecision = precision;
        }
    }

    /**
     * Set available GST rates
     * @param {Array<number>} rates - Array of GST rates
     */
    setGstRates(rates) {
        if (Array.isArray(rates) && rates.length > 0) {
            this._gstRates = rates;
        }
    }

    /**
     * Get available GST rates
     * @returns {Array<number>}
     */
    getGstRates() {
        return [...this._gstRates];
    }

    /**
     * Validate if a GST rate is configured
     * @param {number} rate - GST rate to validate
     * @returns {boolean}
     */
    isValidGstRate(rate) {
        return this._gstRates.includes(Number(rate));
    }

    // ============================================================
    // MAIN CALCULATION
    // ============================================================

    /**
     * Calculate invoice/ quotation totals
     * @param {Object} data - Calculation data
     * @param {Array} data.items - Array of items
     * @param {string} data.discountType - 'none', 'percentage', or 'flat'
     * @param {number} data.discountValue - Discount value
     * @param {boolean} data.gstEnabled - Whether GST is enabled
     * @param {string} data.gstType - 'intra' or 'inter'
     * @param {number} data.gstRate - GST rate percentage (must be configured)
     * @param {string} data.roundingMode - Rounding mode (optional)
     * @param {number} data.roundingPrecision - Rounding precision (optional)
     * @returns {Object} - Calculated results
     */
    calculateInvoice(data) {
        // Validate input
        this._validateInput(data);

        // Normalize input
        const normalized = this._normalizeInput(data);

        // 1. Calculate item totals
        const items = this._calculateItems(normalized.items);

        // 2. Calculate subtotal
        const subtotal = this._calculateSubtotal(items);

        // 3. Calculate discount
        const discountResult = this._calculateDiscount(
            subtotal,
            normalized.discountType,
            normalized.discountValue
        );

        // 4. Calculate taxable amount
        const taxableAmount = this._calculateTaxableAmount(
            subtotal,
            discountResult.amount
        );

        // 5. Calculate GST
        const gstResult = this._calculateGst(
            taxableAmount,
            normalized.gstEnabled,
            normalized.gstType,
            normalized.gstRate
        );

        // 6. Calculate grand total
        let grandTotal = this._calculateGrandTotal(
            taxableAmount,
            gstResult.totalGst
        );

        // 7. Apply round off
        const roundingResult = this._applyRoundOff(
            grandTotal,
            normalized.roundingMode || this._roundingMode,
            normalized.roundingPrecision ?? this._roundingPrecision
        );

        // 8. Prepare result
        return {
            // Items with calculated values
            items: items.map(item => ({
                ...item,
                taxableAmount: item.taxableAmount,
                total: item.total
            })),

            // Summary totals
            subtotal: subtotal,
            
            // Discount
            discountType: normalized.discountType,
            discountValue: normalized.discountValue,
            discountAmount: discountResult.amount,
            
            // GST
            gstEnabled: normalized.gstEnabled,
            gstType: normalized.gstType,
            gstRate: normalized.gstRate,
            cgst: gstResult.cgst,
            sgst: gstResult.sgst,
            igst: gstResult.igst,
            gstAmount: gstResult.totalGst,
            
            // Final totals
            taxableAmount: taxableAmount,
            roundingMode: roundingResult.mode,
            roundingPrecision: roundingResult.precision,
            roundOff: roundingResult.roundOff,
            grandTotal: roundingResult.roundedTotal,
            originalGrandTotal: grandTotal
        };
    }

    // ============================================================
    // ITEM CALCULATION
    // ============================================================

    /**
     * Calculate individual item totals
     * @param {Array} items - Array of items
     * @returns {Array} - Items with calculated values
     */
    _calculateItems(items) {
        return items.map(item => {
            const quantity = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            
            // Quantity × Rate = Gross Amount
            const grossAmount = this._round(quantity * rate, 2);
            
            // For now, taxable amount = gross amount
            // (discount is applied at invoice level)
            const taxableAmount = grossAmount;
            const total = grossAmount;

            return {
                ...item,
                quantity: quantity,
                rate: rate,
                grossAmount: grossAmount,
                taxableAmount: taxableAmount,
                total: total
            };
        });
    }

    // ============================================================
    // SUBTOTAL CALCULATION
    // ============================================================

    /**
     * Calculate subtotal from items
     * @param {Array} items - Items with calculated values
     * @returns {number} - Subtotal
     */
    _calculateSubtotal(items) {
        return items.reduce((sum, item) => {
            return sum + (item.grossAmount || 0);
        }, 0);
    }

    // ============================================================
    // DISCOUNT CALCULATION
    // ============================================================

    /**
     * Calculate discount
     * @param {number} subtotal - Subtotal amount
     * @param {string} discountType - 'none', 'percentage', or 'flat'
     * @param {number} discountValue - Discount value
     * @returns {Object} - { amount: number }
     */
    _calculateDiscount(subtotal, discountType, discountValue) {
        const value = Number(discountValue) || 0;
        
        if (discountType === 'none' || value <= 0) {
            return { amount: 0 };
        }

        let amount = 0;
        if (discountType === 'percentage') {
            // Percentage of subtotal
            amount = this._round((subtotal * value) / 100, 2);
        } else if (discountType === 'flat') {
            // Flat amount (capped at subtotal)
            amount = this._round(Math.min(value, subtotal), 2);
        }

        return { amount: amount };
    }

    // ============================================================
    // TAXABLE AMOUNT CALCULATION
    // ============================================================

    /**
     * Calculate taxable amount
     * @param {number} subtotal - Subtotal amount
     * @param {number} discountAmount - Discount amount
     * @returns {number} - Taxable amount
     */
    _calculateTaxableAmount(subtotal, discountAmount) {
        return this._round(Math.max(0, subtotal - discountAmount), 2);
    }

    // ============================================================
    // GST CALCULATION
    // ============================================================

    /**
     * Calculate GST
     * @param {number} taxableAmount - Taxable amount
     * @param {boolean} gstEnabled - Whether GST is enabled
     * @param {string} gstType - 'intra' or 'inter'
     * @param {number} gstRate - GST rate percentage (must be configured)
     * @returns {Object} - { cgst, sgst, igst, totalGst }
     */
    _calculateGst(taxableAmount, gstEnabled, gstType, gstRate) {
        // If GST is disabled, return all zeros
        if (!gstEnabled) {
            return {
                cgst: 0,
                sgst: 0,
                igst: 0,
                totalGst: 0
            };
        }

        const rate = Number(gstRate) || 0;
        
        // Validate rate is configured
        if (!this.isValidGstRate(rate)) {
            throw new Error(`Invalid GST rate: ${rate}. Available rates: ${this._gstRates.join(', ')}`);
        }

        const totalGst = this._round((taxableAmount * rate) / 100, 2);

        if (gstType === 'intra') {
            // Intra-state: CGST + SGST (half each)
            const half = this._round(totalGst / 2, 2);
            // Ensure CGST + SGST = totalGst (handle rounding)
            return {
                cgst: half,
                sgst: this._round(totalGst - half, 2),
                igst: 0,
                totalGst: totalGst
            };
        } else {
            // Inter-state: IGST (full amount)
            return {
                cgst: 0,
                sgst: 0,
                igst: totalGst,
                totalGst: totalGst
            };
        }
    }

    // ============================================================
    // GRAND TOTAL CALCULATION
    // ============================================================

    /**
     * Calculate grand total
     * @param {number} taxableAmount - Taxable amount
     * @param {number} gstAmount - Total GST amount
     * @returns {number} - Grand total
     */
    _calculateGrandTotal(taxableAmount, gstAmount) {
        return this._round(taxableAmount + gstAmount, 2);
    }

    // ============================================================
    // ROUND OFF
    // ============================================================

    /**
     * Apply round off with configurable mode
     * @param {number} value - Value to round
     * @param {string} mode - Rounding mode
     * @param {number} precision - Number of decimal places
     * @returns {Object} - { mode, precision, roundOff, roundedTotal }
     */
    _applyRoundOff(value, mode, precision) {
        const rounded = this._roundValue(value, mode, precision);
        const roundOff = this._round(rounded - value, precision);
        
        return {
            mode: mode,
            precision: precision,
            roundOff: roundOff,
            roundedTotal: rounded
        };
    }

    /**
     * Round a value with specified mode
     * @param {number} value - Value to round
     * @param {string} mode - Rounding mode
     * @param {number} precision - Number of decimal places
     * @returns {number} - Rounded value
     */
    _roundValue(value, mode, precision) {
        const factor = Math.pow(10, precision);
        const scaled = value * factor;

        let roundedScaled;

        switch (mode) {
            case 'none':
                return value;
            
            case 'nearest':
                roundedScaled = Math.round(scaled);
                break;
            
            case 'up':
                roundedScaled = Math.ceil(scaled);
                break;
            
            case 'down':
                roundedScaled = Math.floor(scaled);
                break;
            
            case 'nearest-5': {
                const nearest5 = Math.round(scaled / 5) * 5;
                roundedScaled = nearest5;
                break;
            }
            
            case 'nearest-10': {
                const nearest10 = Math.round(scaled / 10) * 10;
                roundedScaled = nearest10;
                break;
            }
            
            default:
                roundedScaled = Math.round(scaled);
        }

        return roundedScaled / factor;
    }

    /**
     * Round a number to specified precision
     * @param {number} value - Value to round
     * @param {number} precision - Number of decimal places
     * @returns {number} - Rounded value
     */
    _round(value, precision = 2) {
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    // ============================================================
    // INPUT VALIDATION
    // ============================================================

    /**
     * Validate calculation input
     * @param {Object} data - Input data
     * @throws {Error} - If validation fails
     */
    _validateInput(data) {
        if (!data) {
            throw new Error('Calculation data is required');
        }

        // Items validation
        if (!data.items || !Array.isArray(data.items)) {
            throw new Error('Items must be an array');
        }

        // Discount validation
        if (data.discountType && !DISCOUNT_TYPES.includes(data.discountType)) {
            throw new Error(`Invalid discount type: ${data.discountType}`);
        }

        if (data.discountValue !== undefined && data.discountValue < 0) {
            throw new Error('Discount value cannot be negative');
        }

        // GST validation
        if (data.gstEnabled) {
            if (data.gstType && !GST_TYPES.includes(data.gstType)) {
                throw new Error(`Invalid GST type: ${data.gstType}. Available: ${GST_TYPES.join(', ')}`);
            }
            if (data.gstRate !== undefined) {
                const rate = Number(data.gstRate);
                if (isNaN(rate) || rate < 0 || rate > 100) {
                    throw new Error(`Invalid GST rate: ${data.gstRate}. Rate must be between 0 and 100`);
                }
                if (!this.isValidGstRate(rate)) {
                    throw new Error(`Invalid GST rate: ${rate}. Available rates: ${this._gstRates.join(', ')}`);
                }
            }
        }

        // Rounding validation
        if (data.roundingMode && !ROUNDING_MODES.includes(data.roundingMode)) {
            throw new Error(`Invalid rounding mode: ${data.roundingMode}. Available: ${ROUNDING_MODES.join(', ')}`);
        }
        if (data.roundingPrecision !== undefined && data.roundingPrecision < 0) {
            throw new Error('Rounding precision cannot be negative');
        }
    }

    // ============================================================
    // INPUT NORMALIZATION
    // ============================================================

    /**
     * Normalize calculation input
     * @param {Object} data - Input data
     * @returns {Object} - Normalized data
     */
    _normalizeInput(data) {
        return {
            items: (data.items || []).map(item => ({
                ...item,
                quantity: Number(item.quantity) || 0,
                rate: Number(item.rate) || 0
            })),
            discountType: data.discountType || 'none',
            discountValue: Number(data.discountValue) || 0,
            gstEnabled: data.gstEnabled !== false,
            gstType: data.gstType || 'intra',
            gstRate: Number(data.gstRate) || 0,
            roundingMode: data.roundingMode || this._roundingMode,
            roundingPrecision: data.roundingPrecision ?? this._roundingPrecision
        };
    }

    // ============================================================
    // CONVENIENCE METHODS
    // ============================================================

    /**
     * Quick calculation with minimal data
     * @param {Array} items - Array of { quantity, rate }
     * @param {Object} options - Calculation options
     * @returns {Object} - Calculated results
     */
    quickCalculate(items, options = {}) {
        const data = {
            items: items,
            discountType: options.discountType || 'none',
            discountValue: options.discountValue || 0,
            gstEnabled: options.gstEnabled !== false,
            gstType: options.gstType || 'intra',
            gstRate: options.gstRate || 18,
            roundingMode: options.roundingMode || this._roundingMode,
            roundingPrecision: options.roundingPrecision ?? this._roundingPrecision
        };

        return this.calculateInvoice(data);
    }

    /**
     * Calculate only subtotal and grand total
     * @param {Array} items - Array of { quantity, rate }
     * @returns {Object} - { subtotal, total }
     */
    calculateSimpleTotal(items) {
        let subtotal = 0;
        for (const item of items) {
            subtotal += (Number(item.quantity) || 0) * (Number(item.rate) || 0);
        }
        return {
            subtotal: this._round(subtotal, 2),
            total: this._round(subtotal, 2)
        };
    }
}

// ============================================================
// HELPER FUNCTIONS (Separate from calculation engine)
// ============================================================

/**
 * Format amount with currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency symbol (default: ₹)
 * @param {number} precision - Decimal places
 * @returns {string} - Formatted amount
 */
export function formatAmount(amount, currency = '₹', precision = 2) {
    const num = Math.round(amount * Math.pow(10, precision)) / Math.pow(10, precision);
    const parts = num.toFixed(precision).split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${currency}${integerPart}${parts[1] ? '.' + parts[1] : ''}`;
}

/**
 * Convert amount to words (Indian numbering with paise)
 * @param {number} amount - Amount to convert
 * @param {string} currency - Currency name (default: 'Rupees')
 * @returns {string} - Amount in words
 */
export function toWords(amount, currency = 'Rupees') {
    const num = Math.round(amount * 100) / 100;
    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num - integerPart) * 100);

    if (num === 0) return `Zero ${currency} Only`;

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const getWord = (n) => {
        if (n === 0) return '';
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + getWord(n % 100) : '');
        return '';
    };

    const crore = Math.floor(integerPart / 10000000);
    const lakh = Math.floor((integerPart % 10000000) / 100000);
    const thousand = Math.floor((integerPart % 100000) / 1000);
    const remainder = integerPart % 1000;

    let words = '';
    if (crore) words += getWord(crore) + ' Crore ';
    if (lakh) words += getWord(lakh) + ' Lakh ';
    if (thousand) words += getWord(thousand) + ' Thousand ';
    if (remainder) words += getWord(remainder);

    let result = words.trim();
    
    if (!result) {
        result = 'Zero';
    }

    // Add paise if present
    if (decimalPart > 0) {
        const paiseWords = getWord(decimalPart);
        const paiseCurrency = 'Paise';
        if (paiseWords) {
            result += ` and ${paiseWords} ${paiseCurrency}`;
        }
    }

    return `${currency} ${result} Only`;
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const calculationEngine = new CalculationEngine();

// ============================================================
// EXPORT
// ============================================================

export { calculationEngine, formatAmount, toWords };
export default calculationEngine;

// ============================================================
// USAGE EXAMPLES
// ============================================================

/*
// ============================================================
// BASIC INVOICE CALCULATION
// ============================================================

import calculationEngine, { formatAmount, toWords } from './calculation-engine.js';

const result = calculationEngine.calculateInvoice({
    items: [
        { productId: 'prod-1', quantity: 20, rate: 450 },
        { productId: 'prod-2', quantity: 10, rate: 800 }
    ],
    discountType: 'percentage',
    discountValue: 10,
    gstEnabled: true,
    gstType: 'intra',
    gstRate: 18,
    roundingMode: 'nearest',
    roundingPrecision: 0  // Whole rupees
});

console.log('Subtotal:', formatAmount(result.subtotal));
console.log('Discount:', formatAmount(result.discountAmount));
console.log('Taxable:', formatAmount(result.taxableAmount));
console.log('CGST:', formatAmount(result.cgst));
console.log('SGST:', formatAmount(result.sgst));
console.log('Grand Total:', formatAmount(result.grandTotal));
console.log('Amount in Words:', toWords(result.grandTotal));


// ============================================================
// ROUND OFF MODES
// ============================================================

// Nearest rupee
calc.setRoundingMode('nearest');
calc.setRoundingPrecision(0);

// Round up
calc.setRoundingMode('up');

// Round down
calc.setRoundingMode('down');

// Nearest 5
calc.setRoundingMode('nearest-5');

// Nearest 10
calc.setRoundingMode('nearest-10');

// No rounding
calc.setRoundingMode('none');
calc.setRoundingPrecision(2);


// ============================================================
// GST RATE VALIDATION
// ============================================================

// This will throw error because 13% is not configured
try {
    calculationEngine.calculateInvoice({
        items: [{ quantity: 20, rate: 450 }],
        gstRate: 13
    });
} catch (error) {
    console.log('Error:', error.message);
    // Invalid GST rate: 13. Available rates: 0, 5, 7, 9, 18, 28
}


// ============================================================
// AMOUNT TO WORDS WITH PAISE
// ============================================================

console.log(toWords(12345.67));
// Rupees Twelve Thousand Three Hundred Forty Five and Sixty Seven Paise Only

console.log(toWords(1000));
// Rupees One Thousand Only

console.log(toWords(0));
// Zero Rupees Only
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// GST RATES: 0, 5, 7, 9, 18, 28
// 
// ROUNDING MODES:
// - none: No rounding
// - nearest: Round to nearest (0.5 up)
// - up: Round up (ceiling)
// - down: Round down (floor)
// - nearest-5: Round to nearest 5
// - nearest-10: Round to nearest 10
// 
// CALCULATIONS:
// - Item Total = Quantity × Rate
// - Subtotal = Sum of Item Totals
// - Discount Amount = Subtotal × % or Flat amount
// - Taxable Amount = Subtotal - Discount
// - GST = Taxable × Rate%
// - CGST = GST/2 (Intra-state)
// - SGST = GST/2 (Intra-state)
// - IGST = GST (Inter-state)
// - Grand Total = Taxable + GST
// - Round Off = Grand Total - Rounded Total
// 
// RULES:
// - GST is Invoice-level ONLY
// - Discount is Invoice-level ONLY
// - Only configured GST rates are accepted
// - Pure calculations only
// - No database access
// - No UI access
// 
// ============================================================