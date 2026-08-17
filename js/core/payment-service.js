/**
 * H4 Billing ERP - Payment Service Module
 * Central service for payment operations
 * Version: 1.0.0
 * 
 * ============================================================
 * ARCHITECTURE PRINCIPLES
 * ============================================================
 * 
 * 1. PAYMENTS = SOURCE OF TRUTH
 *    - All payment records are authoritative
 *    - Invoice payment status is DERIVED from payments
 * 
 * 2. PAYMENT FIRST
 *    - Payment is always saved first
 *    - Invoice status update is best effort
 *    - If invoice update fails, payment remains saved
 * 
 * 3. DERIVED / CACHE FIELDS ON INVOICE
 *    - paidAmount (cached from payments)
 *    - outstandingAmount (cached from payments)
 *    - paymentStatus (cached from payments)
 *    - These are NOT authoritative - they are for performance only
 * 
 * ============================================================
 * INCONSISTENCY HANDLING
 * ============================================================
 * 
 * If invoice status update fails:
 * - Payment is saved ✅ (source of truth preserved)
 * - Error is logged with full context
 * - Admin can manually reconcile via payment list
 * - Future: Background sync job can retry
 * 
 * This is preferable to rolling back a valid payment.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: payments
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.PAYMENT_CREATED
 * - EVENTS.PAYMENT_UPDATED
 * - EVENTS.PAYMENT_DELETED
 * 
 * ============================================================
 * IMMUTABLE RULES
 * ============================================================
 * 
 * - invoiceId CANNOT be changed after creation
 * - If payment is on wrong invoice, delete and recreate
 * - Payment number CANNOT be changed after creation
 * - Payment ID CANNOT be changed
 * - All other fields can be updated
 * 
 * ============================================================
 * STORE CREATION RULE
 * ============================================================
 * 
 * payment-service.js does NOT create any store.
 * Stores are created by migration.js only.
 * numbering store MUST exist (created by migration.js).
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB directly
 * - Does NOT define DB_NAME or DB_VERSION
 * - Does NOT create another database
 * - Does NOT create stores (belongs to migration.js)
 * - Does NOT contain GST/discount calculation formulas
 * - Does NOT contain UI logic
 * - Does NOT render PDF/Print/WhatsApp
 * - Does NOT use calculation-engine.js
 * ============================================================
 */

// ============================================================
// IMPORTS
// ============================================================

import { database } from '../core/database.js';
import { state } from '../core/state.js';
import { eventBus, EVENTS } from '../core/events.js';
import { customerService } from './customer-service.js';
import { invoiceService } from './invoice-service.js';

// ============================================================
// CONSTANTS
// ============================================================

const STORE_NAME = 'payments';
const NUMBERING_STORE_NAME = 'numbering';

const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];
const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'overpaid'];

// ============================================================
// PAYMENT SERVICE CLASS
// ============================================================

class PaymentService {
    constructor() {
        this._storeName = STORE_NAME;
        this._numberingStoreName = NUMBERING_STORE_NAME;
        this._initialized = false;
    }

    /**
     * Initialize the service
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) return;
        await database.open();
        await customerService.initialize();
        await invoiceService.initialize();
        this._initialized = true;
        console.log('💰 Payment service initialized');
    }

    // ============================================================
    // GENERATE PAYMENT NUMBER
    // ============================================================

    /**
     * Generate the next payment number
     * Uses numbering store (MUST be created by migration.js)
     * @returns {Promise<string>} - Next payment number
     * @throws {Error} - If numbering store does not exist
     */
    async generatePaymentNumber() {
        await this.initialize();

        const settings = await database.get('settings', 'settings');
        const numbering = settings?.documentNumbering?.payment || {
            prefix: 'PAY-',
            start: 1,
            padding: 5
        };

        // NUMBERING STORE MUST EXIST - Created by migration.js
        const numberingState = await database.get(this._numberingStoreName, 'numbering');
        if (!numberingState) {
            throw new Error(
                `Numbering store not found. Ensure migration.js has created the numbering store. ` +
                `Store name: ${this._numberingStoreName}`
            );
        }

        const currentYear = new Date().getFullYear();
        let current = numberingState.payment.current || numbering.start || 1;

        if (numbering.yearlyReset && numberingState.payment.year !== currentYear) {
            current = numbering.start || 1;
            numberingState.payment.year = currentYear;
        }

        const padded = String(current).padStart(numbering.padding || 5, '0');
        const paymentNumber = `${numbering.prefix || 'PAY-'}${padded}`;

        numberingState.payment.current = current + 1;
        numberingState.updatedAt = new Date().toISOString();
        await database.put(this._numberingStoreName, numberingState);

        return paymentNumber;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate payment data
     * @param {Object} data - Payment data to validate
     * @param {boolean} isUpdate - Whether this is an update operation
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validatePayment(data, isUpdate = false) {
        const errors = [];

        // Invoice ID is required (and immutable on update)
        if (!data.invoiceId) {
            errors.push('Invoice ID is required');
        }

        // Amount must be positive
        if (data.amount === undefined || data.amount === null) {
            errors.push('Amount is required');
        } else if (typeof data.amount !== 'number' || data.amount <= 0) {
            errors.push('Amount must be a positive number');
        }

        // Payment method must be valid
        if (data.paymentMethod && !PAYMENT_METHODS.includes(data.paymentMethod)) {
            errors.push(`Invalid payment method: ${data.paymentMethod}. Available: ${PAYMENT_METHODS.join(', ')}`);
        }

        // Payment date is required
        if (!data.paymentDate) {
            errors.push('Payment date is required');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // NORMALIZATION
    // ============================================================

    /**
     * Normalize payment data before saving
     * @param {Object} data - Payment data to normalize
     * @returns {Object} - Normalized payment data
     */
    normalizePayment(data) {
        const normalized = { ...data };

        // Trim string fields
        if (normalized.referenceNumber) normalized.referenceNumber = normalized.referenceNumber.trim();
        if (normalized.bankName) normalized.bankName = normalized.bankName.trim();
        if (normalized.accountName) normalized.accountName = normalized.accountName.trim();
        if (normalized.notes) normalized.notes = normalized.notes.trim();

        // Ensure amount is a number
        if (normalized.amount !== undefined) {
            normalized.amount = Number(normalized.amount) || 0;
        }

        // Set default payment method if not provided
        if (!normalized.paymentMethod) {
            normalized.paymentMethod = 'Cash';
        }

        return normalized;
    }

    // ============================================================
    // CREATE PAYMENT
    // ============================================================

    /**
     * Create a new payment
     * 
     * ARCHITECTURE: PAYMENT FIRST
     * - Payment is saved FIRST (source of truth)
     * - Invoice status update is attempted AFTER
     * - If invoice update fails, payment is still saved
     * - Error is logged for admin reconciliation
     * 
     * @param {Object} data - Payment data
     * @returns {Promise<Object>} - Created payment
     */
    async createPayment(data) {
        await this.initialize();

        // Validate
        const validation = this.validatePayment(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizePayment(data);

        // Validate invoice exists
        const invoice = await invoiceService.getInvoice(normalized.invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${normalized.invoiceId}`);
        }

        // Get customer snapshot from invoice
        let customerSnapshot = null;
        if (invoice.customerId) {
            try {
                customerSnapshot = await customerService.createCustomerSnapshot(invoice.customerId);
            } catch (error) {
                customerSnapshot = invoice.customerSnapshot || null;
            }
        }

        // Generate payment number (requires numbering store)
        const paymentNumber = await this.generatePaymentNumber();

        // Prepare payment object
        const now = new Date().toISOString();
        const payment = {
            id: database.generateId ? database.generateId() : crypto.randomUUID(),
            paymentNumber: paymentNumber,
            paymentDate: normalized.paymentDate || new Date().toISOString().split('T')[0],
            invoiceId: normalized.invoiceId,
            invoiceNumber: invoice.invoiceNumber || '',
            customerId: invoice.customerId || '',
            customerSnapshot: customerSnapshot,
            amount: normalized.amount || 0,
            paymentMethod: normalized.paymentMethod || 'Cash',
            referenceNumber: normalized.referenceNumber || '',
            bankName: normalized.bankName || '',
            accountName: normalized.accountName || '',
            notes: normalized.notes || '',
            createdAt: now,
            updatedAt: now
        };

        // ============================================================
        // PAYMENT FIRST - Save payment (source of truth)
        // ============================================================
        await database.add(this._storeName, payment);

        // ============================================================
        // INVOICE STATUS UPDATE - Best effort (derived/cache)
        // ============================================================
        let statusUpdateError = null;
        let statusUpdateResult = null;
        try {
            statusUpdateResult = await this._updateInvoicePaymentStatus(invoice.id);
            if (!statusUpdateResult.success) {
                statusUpdateError = statusUpdateResult.error;
            }
        } catch (error) {
            statusUpdateError = error;
        }

        // If invoice status update failed, log with full context
        if (statusUpdateError) {
            console.error(
                `⚠️ INVOICE STATUS UPDATE FAILED BUT PAYMENT IS SAVED\n` +
                `Payment: ${payment.paymentNumber}\n` +
                `Invoice: ${invoice.invoiceNumber}\n` +
                `Amount: ${payment.amount}\n` +
                `Error: ${statusUpdateError.message}\n` +
                `ACTION REQUIRED: Manually reconcile invoice payment status.`
            );
        }

        // Update state
        try {
            const payments = await database.getAll(this._storeName);
            state.set('payments', payments);
            state.set('currentPayment', payment);
        } catch (error) {
            console.warn('⚠️ Failed to update payment state:', error.message);
        }

        // Emit event with status update error info
        await eventBus.emit(
            EVENTS.PAYMENT_CREATED,
            {
                id: payment.id,
                paymentNumber: payment.paymentNumber,
                invoiceId: payment.invoiceId,
                invoiceNumber: payment.invoiceNumber,
                amount: payment.amount,
                data: payment,
                statusUpdateSuccess: statusUpdateResult?.success || false,
                statusUpdateError: statusUpdateError ? statusUpdateError.message : null
            },
            'payment-service'
        );

        if (statusUpdateError) {
            console.warn(
                `⚠️ Payment ${payment.paymentNumber} created successfully but invoice ${invoice.invoiceNumber} status update failed. ` +
                `Please reconcile manually.`
            );
        }

        console.log(`💰 Payment created: ${payment.paymentNumber} for ${payment.invoiceNumber}`);
        return payment;
    }

    // ============================================================
    // GET PAYMENT
    // ============================================================

    /**
     * Get a payment by ID
     * @param {string} id - Payment ID
     * @returns {Promise<Object|null>} - Payment or null
     */
    async getPayment(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    /**
     * Get a payment by payment number
     * @param {string} paymentNumber - Payment number
     * @returns {Promise<Object|null>} - Payment or null
     */
    async getPaymentByNumber(paymentNumber) {
        await this.initialize();
        const allPayments = await database.getAll(this._storeName);
        return allPayments.find(p => p.paymentNumber === paymentNumber) || null;
    }

    // ============================================================
    // GET ALL PAYMENTS
    // ============================================================

    /**
     * Get all payments with options
     * @param {Object} options - Query options
     * @param {string} options.invoiceId - Filter by invoice
     * @param {string} options.customerId - Filter by customer
     * @param {string} options.paymentMethod - Filter by method
     * @param {string} options.dateFrom - Filter by date from
     * @param {string} options.dateTo - Filter by date to
     * @param {string} options.sortBy - Field to sort by
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @param {number} options.limit - Maximum results
     * @param {number} options.offset - Number to skip
     * @returns {Promise<Array>} - Array of payments
     */
    async getPayments(options = {}) {
        await this.initialize();

        let payments = await database.getAll(this._storeName);

        if (options.invoiceId) {
            payments = payments.filter(p => p.invoiceId === options.invoiceId);
        }

        if (options.customerId) {
            payments = payments.filter(p => p.customerId === options.customerId);
        }

        if (options.paymentMethod && options.paymentMethod !== 'all') {
            payments = payments.filter(p => p.paymentMethod === options.paymentMethod);
        }

        if (options.dateFrom) {
            payments = payments.filter(p => p.paymentDate >= options.dateFrom);
        }
        if (options.dateTo) {
            payments = payments.filter(p => p.paymentDate <= options.dateTo);
        }

        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            payments.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        } else {
            payments.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
        }

        if (options.limit) {
            const offset = options.offset || 0;
            payments = payments.slice(offset, offset + options.limit);
        }

        return payments;
    }

    // ============================================================
    // GET INVOICE PAYMENTS
    // ============================================================

    /**
     * Get all payments for an invoice
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Array>} - Array of payments
     */
    async getInvoicePayments(invoiceId) {
        return this.getPayments({ invoiceId: invoiceId });
    }

    /**
     * Get all payments for a customer
     * @param {string} customerId - Customer ID
     * @returns {Promise<Array>} - Array of payments
     */
    async getCustomerPayments(customerId) {
        return this.getPayments({ customerId: customerId });
    }

    // ============================================================
    // INVOICE PAYMENT SUMMARY - DERIVED FROM PAYMENTS
    // ============================================================

    /**
     * Get invoice paid amount (DERIVED from payments)
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<number>} - Total paid amount
     */
    async getInvoicePaidAmount(invoiceId) {
        await this.initialize();
        const payments = await this.getInvoicePayments(invoiceId);
        return payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    }

    /**
     * Get invoice outstanding amount (DERIVED from payments)
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<number>} - Outstanding amount
     */
    async getInvoiceOutstandingAmount(invoiceId) {
        await this.initialize();

        const invoice = await invoiceService.getInvoice(invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const totalPaid = await this.getInvoicePaidAmount(invoiceId);
        const grandTotal = invoice.grandTotal || 0;
        
        return Math.max(0, grandTotal - totalPaid);
    }

    /**
     * Get invoice payment status (DERIVED from payments)
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Object>} - Payment status
     */
    async getInvoicePaymentStatus(invoiceId) {
        await this.initialize();

        const invoice = await invoiceService.getInvoice(invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const totalPaid = await this.getInvoicePaidAmount(invoiceId);
        const grandTotal = invoice.grandTotal || 0;
        const outstanding = Math.max(0, grandTotal - totalPaid);

        let status = 'unpaid';
        if (totalPaid > 0) {
            if (totalPaid > grandTotal) {
                status = 'overpaid';
            } else if (totalPaid >= grandTotal) {
                status = 'paid';
            } else {
                status = 'partially_paid';
            }
        }

        return {
            invoiceId: invoiceId,
            invoiceNumber: invoice.invoiceNumber || '',
            grandTotal: grandTotal,
            paidAmount: totalPaid,
            outstandingAmount: outstanding,
            status: status,
            paymentCount: await this.getPaymentCountForInvoice(invoiceId)
        };
    }

    /**
     * Get payment count for an invoice
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<number>} - Number of payments
     */
    async getPaymentCountForInvoice(invoiceId) {
        const payments = await this.getInvoicePayments(invoiceId);
        return payments.length;
    }

    /**
     * Get full payment summary for an invoice (DERIVED from payments)
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Object>} - Payment summary
     */
    async getInvoicePaymentSummary(invoiceId) {
        await this.initialize();

        const invoice = await invoiceService.getInvoice(invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const payments = await this.getInvoicePayments(invoiceId);
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const grandTotal = invoice.grandTotal || 0;
        const outstanding = Math.max(0, grandTotal - totalPaid);

        let status = 'unpaid';
        if (totalPaid > 0) {
            if (totalPaid > grandTotal) {
                status = 'overpaid';
            } else if (totalPaid >= grandTotal) {
                status = 'paid';
            } else {
                status = 'partially_paid';
            }
        }

        return {
            invoiceId: invoiceId,
            invoiceNumber: invoice.invoiceNumber || '',
            grandTotal: grandTotal,
            paidAmount: totalPaid,
            outstandingAmount: outstanding,
            status: status,
            paymentCount: payments.length,
            payments: payments
        };
    }

    // ============================================================
    // UPDATE INVOICE PAYMENT STATUS - CACHE ONLY
    // ============================================================

    /**
     * Update invoice payment status in invoice record (CACHE ONLY)
     * 
     * ARCHITECTURE: This updates the CACHED fields on invoice
     * The authoritative source is the payments store.
     * If this fails, the invoice cache is stale but payments are correct.
     * 
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Object>} - { success: boolean, error: Error|null }
     */
    async _updateInvoicePaymentStatus(invoiceId) {
        try {
            // Derive status from payments (source of truth)
            const status = await this.getInvoicePaymentStatus(invoiceId);
            
            // Update invoice cache fields
            await invoiceService.updateInvoice(invoiceId, {
                paymentStatus: status.status,
                paidAmount: status.paidAmount,
                outstandingAmount: status.outstandingAmount
            });
            
            return { success: true, error: null };
        } catch (error) {
            console.error(`❌ Invoice cache update failed for ${invoiceId}:`, error.message);
            return { success: false, error: error };
        }
    }

    // ============================================================
    // UPDATE PAYMENT
    // ============================================================

    /**
     * Update an existing payment
     * IMPORTANT: invoiceId CANNOT be changed. It is immutable.
     * @param {string} id - Payment ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated payment
     */
    async updatePayment(id, updates) {
        await this.initialize();

        // Get existing payment
        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Payment not found: ${id}`);
        }

        // IMMUTABLE: invoiceId CANNOT be changed
        if (updates.invoiceId && updates.invoiceId !== existing.invoiceId) {
            throw new Error(
                `Cannot change invoiceId. Payment "${existing.paymentNumber}" is linked to invoice "${existing.invoiceNumber}". ` +
                `If this payment is for a different invoice, please delete and create a new payment.`
            );
        }

        // IMMUTABLE: paymentNumber CANNOT be changed
        if (updates.paymentNumber && updates.paymentNumber !== existing.paymentNumber) {
            throw new Error(`Cannot change paymentNumber. It is immutable.`);
        }

        // Merge updates with existing
        const merged = { ...existing, ...updates };

        // Validate merged data
        const validation = this.validatePayment(merged, true);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizePayment(merged);

        // Preserve immutable fields and timestamps
        const updatedPayment = {
            ...normalized,
            id: id,
            paymentNumber: existing.paymentNumber, // IMMUTABLE
            invoiceId: existing.invoiceId,         // IMMUTABLE
            invoiceNumber: existing.invoiceNumber, // IMMUTABLE
            customerId: existing.customerId,       // IMMUTABLE (derived from invoice)
            customerSnapshot: existing.customerSnapshot, // IMMUTABLE (from creation)
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };

        // Save to database
        await database.put(this._storeName, updatedPayment);

        // Update invoice cache (best effort)
        let statusUpdateError = null;
        let statusUpdateResult = null;
        try {
            statusUpdateResult = await this._updateInvoicePaymentStatus(updatedPayment.invoiceId);
            if (!statusUpdateResult.success) {
                statusUpdateError = statusUpdateResult.error;
            }
        } catch (error) {
            statusUpdateError = error;
        }

        if (statusUpdateError) {
            console.error(
                `⚠️ INVOICE CACHE UPDATE FAILED BUT PAYMENT IS UPDATED\n` +
                `Payment: ${updatedPayment.paymentNumber}\n` +
                `Invoice: ${updatedPayment.invoiceNumber}\n` +
                `Error: ${statusUpdateError.message}\n` +
                `ACTION REQUIRED: Manually reconcile invoice cache.`
            );
        }

        // Update state
        try {
            const payments = await database.getAll(this._storeName);
            state.set('payments', payments);
            state.set('currentPayment', updatedPayment);
        } catch (error) {
            console.warn('⚠️ Failed to update payment state:', error.message);
        }

        // Emit event
        await eventBus.emit(
            EVENTS.PAYMENT_UPDATED,
            {
                id: updatedPayment.id,
                paymentNumber: updatedPayment.paymentNumber,
                invoiceId: updatedPayment.invoiceId,
                invoiceNumber: updatedPayment.invoiceNumber,
                amount: updatedPayment.amount,
                data: updatedPayment,
                statusUpdateSuccess: statusUpdateResult?.success || false,
                statusUpdateError: statusUpdateError ? statusUpdateError.message : null
            },
            'payment-service'
        );

        if (statusUpdateError) {
            console.warn(
                `⚠️ Payment ${updatedPayment.paymentNumber} updated but invoice cache update failed. ` +
                `Please reconcile manually.`
            );
        }

        console.log(`💰 Payment updated: ${updatedPayment.paymentNumber}`);
        return updatedPayment;
    }

    // ============================================================
    // DELETE PAYMENT (SAFE)
    // ============================================================

    /**
     * Delete a payment safely
     * @param {string} id - Payment ID
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     * @returns {Promise<Object>} - Result
     */
    async deletePayment(id, confirmation = '') {
        await this.initialize();

        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Payment deletion requires confirmation. Call deletePayment("CONFIRM_DELETE")');
        }

        // Get payment before deletion
        const payment = await database.get(this._storeName, id);
        if (!payment) {
            throw new Error(`Payment not found: ${id}`);
        }

        const invoiceId = payment.invoiceId;

        // Delete from database
        await database.delete(this._storeName, id);

        // Update invoice cache (best effort)
        let statusUpdateError = null;
        let statusUpdateResult = null;
        try {
            statusUpdateResult = await this._updateInvoicePaymentStatus(invoiceId);
            if (!statusUpdateResult.success) {
                statusUpdateError = statusUpdateResult.error;
            }
        } catch (error) {
            statusUpdateError = error;
        }

        if (statusUpdateError) {
            console.error(
                `⚠️ INVOICE CACHE UPDATE FAILED AFTER PAYMENT DELETION\n` +
                `Payment: ${payment.paymentNumber}\n` +
                `Invoice: ${payment.invoiceNumber}\n` +
                `Error: ${statusUpdateError.message}\n` +
                `ACTION REQUIRED: Manually reconcile invoice cache.`
            );
        }

        // Update state
        try {
            const payments = await database.getAll(this._storeName);
            state.set('payments', payments);
            if (state.get('currentPayment')?.id === id) {
                state.set('currentPayment', null);
            }
        } catch (error) {
            console.warn('⚠️ Failed to update payment state:', error.message);
        }

        // Emit event
        await eventBus.emit(
            EVENTS.PAYMENT_DELETED,
            {
                id: payment.id,
                paymentNumber: payment.paymentNumber,
                invoiceId: payment.invoiceId,
                invoiceNumber: payment.invoiceNumber,
                amount: payment.amount,
                data: payment,
                statusUpdateSuccess: statusUpdateResult?.success || false,
                statusUpdateError: statusUpdateError ? statusUpdateError.message : null
            },
            'payment-service'
        );

        if (statusUpdateError) {
            console.warn(
                `⚠️ Payment ${payment.paymentNumber} deleted but invoice cache update failed. ` +
                `Please reconcile manually.`
            );
        }

        console.log(`💰 Payment deleted: ${payment.paymentNumber}`);
        return { success: true, id: id, paymentNumber: payment.paymentNumber };
    }

    // ============================================================
    // PAYMENT STATISTICS
    // ============================================================

    /**
     * Get payment statistics
     * @param {Object} options - Options
     * @param {string} options.customerId - Filter by customer
     * @param {string} options.dateFrom - Filter by date from
     * @param {string} options.dateTo - Filter by date to
     * @returns {Promise<Object>} - Payment statistics
     */
    async getPaymentStats(options = {}) {
        await this.initialize();

        let payments = await database.getAll(this._storeName);

        if (options.customerId) {
            payments = payments.filter(p => p.customerId === options.customerId);
        }
        if (options.dateFrom) {
            payments = payments.filter(p => p.paymentDate >= options.dateFrom);
        }
        if (options.dateTo) {
            payments = payments.filter(p => p.paymentDate <= options.dateTo);
        }

        const total = payments.length;
        const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        const byMethod = {};
        for (const method of PAYMENT_METHODS) {
            byMethod[method] = payments.filter(p => p.paymentMethod === method).length;
        }

        const byMonth = {};
        for (const payment of payments) {
            const month = payment.paymentDate ? payment.paymentDate.substring(0, 7) : 'unknown';
            byMonth[month] = (byMonth[month] || 0) + (payment.amount || 0);
        }

        return {
            total: total,
            totalAmount: totalAmount,
            byMethod: byMethod,
            byMonth: byMonth,
            averageAmount: total > 0 ? totalAmount / total : 0
        };
    }

    /**
     * Count total payments
     * @returns {Promise<number>}
     */
    async countPayments() {
        await this.initialize();
        return database.count(this._storeName);
    }

    // ============================================================
    // SEARCH PAYMENTS
    // ============================================================

    /**
     * Search payments by multiple fields
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Matching payments
     */
    async searchPayments(query, options = {}) {
        await this.initialize();

        if (!query || query.trim() === '') {
            return this.getPayments(options);
        }

        const term = query.toLowerCase().trim();
        let payments = await database.getAll(this._storeName);

        if (options.invoiceId) {
            payments = payments.filter(p => p.invoiceId === options.invoiceId);
        }
        if (options.customerId) {
            payments = payments.filter(p => p.customerId === options.customerId);
        }

        const results = payments.filter(payment => {
            const searchableFields = [
                payment.paymentNumber,
                payment.invoiceNumber,
                payment.customerSnapshot?.name,
                payment.customerSnapshot?.phone,
                payment.customerSnapshot?.email,
                payment.referenceNumber,
                payment.bankName,
                payment.accountName,
                payment.notes
            ];

            return searchableFields.some(field => {
                if (!field) return false;
                return String(field).toLowerCase().includes(term);
            });
        });

        results.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));

        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    // ============================================================
    // PAYMENT METHODS
    // ============================================================

    /**
     * Get all valid payment methods
     * @returns {Array<string>} - Payment methods
     */
    getPaymentMethods() {
        return [...PAYMENT_METHODS];
    }

    /**
     * Get payment status values
     * @returns {Array<string>} - Payment statuses
     */
    getPaymentStatuses() {
        return [...PAYMENT_STATUSES];
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export payments to CSV
     * @param {Array} payments - Payments to export
     * @returns {string} - CSV string
     */
    exportToCSV(payments) {
        const headers = [
            'Payment Number', 'Date', 'Invoice Number', 'Customer', 'Amount',
            'Method', 'Reference', 'Bank Name', 'Account Name', 'Notes', 'Created At'
        ];
        
        const rows = payments.map(p => [
            p.paymentNumber || '',
            p.paymentDate || '',
            p.invoiceNumber || '',
            p.customerSnapshot?.name || '',
            p.amount || 0,
            p.paymentMethod || '',
            p.referenceNumber || '',
            p.bankName || '',
            p.accountName || '',
            p.notes || '',
            p.createdAt || ''
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Import payments from CSV
     * @param {string} csv - CSV string
     * @returns {Promise<Array>} - Imported payment IDs
     */
    async importFromCSV(csv) {
        await this.initialize();

        const lines = csv.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV must contain headers and at least one row');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const importedIds = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const payment = {};

            for (let j = 0; j < headers.length; j++) {
                const key = headers[j];
                const value = values[j] || '';
                
                if (key === 'Payment Number') payment.paymentNumber = value;
                else if (key === 'Date') payment.paymentDate = value;
                else if (key === 'Invoice Number') {
                    const invoices = await database.getAll('invoices');
                    const invoice = invoices.find(inv => inv.invoiceNumber === value);
                    if (invoice) {
                        payment.invoiceId = invoice.id;
                        payment.invoiceNumber = invoice.invoiceNumber;
                        payment.customerId = invoice.customerId;
                    }
                }
                else if (key === 'Customer') payment.customerSnapshot = { name: value };
                else if (key === 'Amount') payment.amount = parseFloat(value) || 0;
                else if (key === 'Method') payment.paymentMethod = value || 'Cash';
                else if (key === 'Reference') payment.referenceNumber = value;
                else if (key === 'Bank Name') payment.bankName = value;
                else if (key === 'Account Name') payment.accountName = value;
                else if (key === 'Notes') payment.notes = value;
            }

            if (!payment.amount || payment.amount <= 0) continue;

            try {
                const created = await this.createPayment(payment);
                importedIds.push(created.id);
            } catch (error) {
                console.warn(`Failed to import payment:`, error);
            }
        }

        return importedIds;
    }

    /**
     * Get payment summary for dashboard
     * @param {string} dateFrom - Date from
     * @param {string} dateTo - Date to
     * @returns {Promise<Object>} - Dashboard summary
     */
    async getPaymentDashboardSummary(dateFrom = null, dateTo = null) {
        await this.initialize();

        let payments = await database.getAll(this._storeName);

        if (dateFrom) {
            payments = payments.filter(p => p.paymentDate >= dateFrom);
        }
        if (dateTo) {
            payments = payments.filter(p => p.paymentDate <= dateTo);
        }

        const total = payments.length;
        const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        const today = new Date().toISOString().split('T')[0];
        const todayPayments = payments.filter(p => p.paymentDate === today);
        const todayAmount = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

        const thisMonth = today.substring(0, 7);
        const monthPayments = payments.filter(p => p.paymentDate && p.paymentDate.startsWith(thisMonth));
        const monthAmount = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

        return {
            totalPayments: total,
            totalAmount: totalAmount,
            todayPayments: todayPayments.length,
            todayAmount: todayAmount,
            monthPayments: monthPayments.length,
            monthAmount: monthAmount,
            averageAmount: total > 0 ? totalAmount / total : 0
        };
    }

    /**
     * Reconcile invoice payment cache
     * Background job to fix stale invoice cache
     * @param {string} invoiceId - Invoice ID to reconcile
     * @returns {Promise<Object>} - Reconciliation result
     */
    async reconcileInvoiceCache(invoiceId) {
        await this.initialize();

        const invoice = await invoiceService.getInvoice(invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const status = await this.getInvoicePaymentStatus(invoiceId);
        
        // Force update cache
        await invoiceService.updateInvoice(invoiceId, {
            paymentStatus: status.status,
            paidAmount: status.paidAmount,
            outstandingAmount: status.outstandingAmount
        });

        return {
            invoiceId: invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            reconciled: true,
            status: status
        };
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const paymentService = new PaymentService();

// ============================================================
// EXPORT
// ============================================================

export { paymentService };
export default paymentService;

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → payments store
// EVENTS: PAYMENT_CREATED, PAYMENT_UPDATED, PAYMENT_DELETED
// 
// ARCHITECTURE PRINCIPLES:
// 
// 1. PAYMENTS = SOURCE OF TRUTH
//    - All payment records are authoritative
//    - Invoice payment status is DERIVED from payments
// 
// 2. PAYMENT FIRST
//    - Payment is always saved first
//    - Invoice status update is best effort
//    - If invoice update fails, payment remains saved
// 
// 3. DERIVED / CACHE FIELDS ON INVOICE
//    - paidAmount (cached from payments)
//    - outstandingAmount (cached from payments)
//    - paymentStatus (cached from payments)
//    - These are NOT authoritative - they are for performance only
// 
// 4. INCONSISTENCY HANDLING
//    - Payment saved ✅ (source of truth preserved)
//    - Error logged with full context
//    - Admin can manually reconcile
//    - Future: Background sync job can retry
// 
// ============================================================