/**
 * H4 Billing ERP - Quotation Service Module
 * Central service for quotation operations
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * quotation-service.js provides a clean API for quotation CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: quotations
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.QUOTATION_CREATED
 * - EVENTS.QUOTATION_UPDATED
 * - EVENTS.QUOTATION_DELETED
 * - EVENTS.QUOTATION_CONVERTED
 * 
 * ============================================================
 * FEATURES
 * ============================================================
 * 
 * - Customer Snapshot (preserve customer data)
 * - Product Snapshot (preserve product data)
 * - Company Snapshot (preserve company data)
 * - Template Snapshot + Version (preserve template design)
 * - Invoice-level Discount (percentage/flat)
 * - GST Configuration (enable/disable, type, rate)
 * - Calculation Engine Integration
 * - Duplicate Quotation
 * - Safe Delete (quotation only)
 * - Quotation Numbering (QT-2026-0001)
 * - Events + State Sync
 * - Convert to Invoice (quotation → invoice)
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB directly
 * - Does NOT define DB_NAME or DB_VERSION
 * - Does NOT create another database
 * - Does NOT contain calculation formulas
 * - Does NOT contain UI logic
 * - Does NOT render A4/PDF/Print
 * - Does NOT handle payment tracking (belongs to payment-service.js)
 * ============================================================
 */

// ============================================================
// IMPORTS
// ============================================================

import { database } from '../core/database.js';
import { state } from '../core/state.js';
import { eventBus, EVENTS } from '../core/events.js';
import { customerService } from './customer-service.js';
import { productService } from './product-service.js';
import { companyService } from './company-service.js';
import { templateService } from './template-service.js';
import { calculationEngine } from '../engines/calculation-engine.js';
import { invoiceService } from './invoice-service.js';

// ============================================================
// CONSTANTS
// ============================================================

const STORE_NAME = 'quotations';
const NUMBERING_STORE_NAME = 'numbering';

const DISCOUNT_TYPES = ['none', 'percentage', 'flat'];
const GST_TYPES = ['intra', 'inter'];
const QUOTATION_TYPES = ['general', 'waterproofing', 'epoxy'];
const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted'];

// ============================================================
// QUOTATION SERVICE CLASS
// ============================================================

class QuotationService {
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
        await productService.initialize();
        await companyService.initialize();
        await templateService.initialize();
        
        // Ensure numbering store exists
        await this._ensureNumberingStore();
        
        this._initialized = true;
        console.log('📄 Quotation service initialized');
    }

    // ============================================================
    // NUMBERING STORE COMPATIBILITY
    // ============================================================

    /**
     * Ensure numbering store exists
     * Compatible with migration.js numbering store
     * @returns {Promise<void>}
     */
    async _ensureNumberingStore() {
        try {
            // Check if numbering store exists
            const numberingState = await database.get(this._numberingStoreName, 'numbering');
            if (!numberingState) {
                // Create default numbering state
                const defaultNumbering = {
                    id: 'numbering',
                    invoice: { current: 1, year: new Date().getFullYear() },
                    quotation: { current: 1, year: new Date().getFullYear() },
                    payment: { current: 1, year: new Date().getFullYear() },
                    updatedAt: new Date().toISOString()
                };
                await database.add(this._numberingStoreName, defaultNumbering);
                console.log('🔢 Numbering store initialized for quotation service');
            }
        } catch (error) {
            // If store doesn't exist, create it
            console.warn('⚠️ Numbering store not found, creating default...');
            const defaultNumbering = {
                id: 'numbering',
                invoice: { current: 1, year: new Date().getFullYear() },
                quotation: { current: 1, year: new Date().getFullYear() },
                payment: { current: 1, year: new Date().getFullYear() },
                updatedAt: new Date().toISOString()
            };
            await database.add(this._numberingStoreName, defaultNumbering);
            console.log('🔢 Numbering store created for quotation service');
        }
    }

    // ============================================================
    // GENERATE QUOTATION NUMBER
    // ============================================================

    /**
     * Generate the next quotation number
     * @returns {Promise<string>} - Next quotation number
     */
    async generateQuotationNumber() {
        await this.initialize();

        const settings = await database.get('settings', 'settings');
        const numbering = settings?.documentNumbering?.quotation || {
            prefix: 'QT-',
            start: 1,
            padding: 5,
            yearlyReset: false
        };

        let numberingState = await database.get(this._numberingStoreName, 'numbering');
        if (!numberingState) {
            numberingState = {
                id: 'numbering',
                invoice: { current: 1, year: new Date().getFullYear() },
                quotation: { current: numbering.start || 1, year: new Date().getFullYear() },
                payment: { current: 1, year: new Date().getFullYear() },
                updatedAt: new Date().toISOString()
            };
            await database.add(this._numberingStoreName, numberingState);
        }

        const currentYear = new Date().getFullYear();
        let current = numberingState.quotation.current || numbering.start || 1;

        if (numbering.yearlyReset && numberingState.quotation.year !== currentYear) {
            current = numbering.start || 1;
            numberingState.quotation.year = currentYear;
        }

        const padded = String(current).padStart(numbering.padding || 5, '0');
        const quotationNumber = `${numbering.prefix || 'QT-'}${padded}`;

        numberingState.quotation.current = current + 1;
        numberingState.updatedAt = new Date().toISOString();
        await database.put(this._numberingStoreName, numberingState);

        return quotationNumber;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate quotation data
     * @param {Object} data - Quotation data to validate
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validateQuotation(data) {
        const errors = [];

        if (!data.customerId) {
            errors.push('Customer is required');
        }

        if (!data.date) {
            errors.push('Quotation date is required');
        }

        if (!data.items || data.items.length === 0) {
            errors.push('At least one item is required');
        } else {
            for (let i = 0; i < data.items.length; i++) {
                const item = data.items[i];
                if (!item.productId) {
                    errors.push(`Item ${i + 1}: Product is required`);
                }
                if (!item.quantity || item.quantity <= 0) {
                    errors.push(`Item ${i + 1}: Valid quantity is required`);
                }
                if (item.rate === undefined || item.rate === null || item.rate < 0) {
                    errors.push(`Item ${i + 1}: Valid rate is required`);
                }
            }
        }

        if (data.discountType && !DISCOUNT_TYPES.includes(data.discountType)) {
            errors.push(`Invalid discount type: ${data.discountType}`);
        }
        if (data.discountValue !== undefined && data.discountValue < 0) {
            errors.push('Discount value cannot be negative');
        }

        if (data.gstEnabled) {
            if (data.gstType && !GST_TYPES.includes(data.gstType)) {
                errors.push(`Invalid GST type: ${data.gstType}`);
            }
            if (data.gstRate !== undefined) {
                const rates = calculationEngine.getGstRates();
                if (!rates.includes(Number(data.gstRate))) {
                    errors.push(`Invalid GST rate: ${data.gstRate}. Available: ${rates.join(', ')}`);
                }
            }
        }

        if (data.status && !QUOTATION_STATUSES.includes(data.status)) {
            errors.push(`Invalid status: ${data.status}. Available: ${QUOTATION_STATUSES.join(', ')}`);
        }

        if (data.quotationType && !QUOTATION_TYPES.includes(data.quotationType)) {
            errors.push(`Invalid quotation type: ${data.quotationType}. Available: ${QUOTATION_TYPES.join(', ')}`);
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
     * Normalize quotation data before saving
     * @param {Object} data - Quotation data to normalize
     * @returns {Object} - Normalized quotation data
     */
    normalizeQuotation(data) {
        const normalized = { ...data };

        if (normalized.notes) normalized.notes = normalized.notes.trim();
        if (normalized.terms) normalized.terms = normalized.terms.trim();
        if (normalized.reference) normalized.reference = normalized.reference.trim();
        if (normalized.projectName) normalized.projectName = normalized.projectName.trim();

        if (normalized.subtotal !== undefined) normalized.subtotal = Number(normalized.subtotal) || 0;
        if (normalized.discountValue !== undefined) normalized.discountValue = Number(normalized.discountValue) || 0;
        if (normalized.discountAmount !== undefined) normalized.discountAmount = Number(normalized.discountAmount) || 0;
        if (normalized.gstRate !== undefined) normalized.gstRate = Number(normalized.gstRate) || 18;
        if (normalized.cgst !== undefined) normalized.cgst = Number(normalized.cgst) || 0;
        if (normalized.sgst !== undefined) normalized.sgst = Number(normalized.sgst) || 0;
        if (normalized.igst !== undefined) normalized.igst = Number(normalized.igst) || 0;
        if (normalized.gstAmount !== undefined) normalized.gstAmount = Number(normalized.gstAmount) || 0;
        if (normalized.roundOff !== undefined) normalized.roundOff = Number(normalized.roundOff) || 0;
        if (normalized.grandTotal !== undefined) normalized.grandTotal = Number(normalized.grandTotal) || 0;

        if (normalized.items) {
            normalized.items = normalized.items.map(item => ({
                productId: item.productId || '',
                productSnapshot: item.productSnapshot || null,
                name: item.name || '',
                code: item.code || '',
                sku: item.sku || '',
                hsn: item.hsn || '',
                category: item.category || '',
                unit: item.unit || 'Nos',
                quantity: Number(item.quantity) || 0,
                rate: Number(item.rate) || 0,
                grossAmount: Number(item.grossAmount) || 0,
                taxableAmount: Number(item.taxableAmount) || 0,
                total: Number(item.total) || 0,
                description: item.description || ''
            }));
        }

        if (!normalized.discountType) normalized.discountType = 'none';
        if (normalized.gstEnabled === undefined) normalized.gstEnabled = true;
        if (!normalized.gstType) normalized.gstType = 'intra';
        if (normalized.gstRate === undefined || normalized.gstRate === null) normalized.gstRate = 18;
        if (!normalized.status) normalized.status = 'draft';
        if (!normalized.quotationType) normalized.quotationType = 'general';
        if (!normalized.templateId) normalized.templateId = 'quotation-professional';

        return normalized;
    }

    // ============================================================
    // CREATE QUOTATION
    // ============================================================

    /**
     * Create a new quotation
     * @param {Object} data - Quotation data
     * @returns {Promise<Object>} - Created quotation
     */
    async createQuotation(data) {
        await this.initialize();

        const validation = this.validateQuotation(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const normalized = this.normalizeQuotation(data);

        // Get snapshots
        let customerSnapshot = null;
        if (normalized.customerId) {
            customerSnapshot = await customerService.createCustomerSnapshot(normalized.customerId);
        }

        const items = [];
        for (const item of normalized.items) {
            let productSnapshot = null;
            if (item.productId) {
                productSnapshot = await productService.createProductSnapshot(item.productId);
            }
            
            let rate = Number(item.rate) || 0;
            if (!rate && item.productId) {
                rate = await productService.getProductRate(item.productId, item.quantity);
            }

            const grossAmount = (Number(item.quantity) || 0) * rate;

            items.push({
                productId: item.productId,
                productSnapshot: productSnapshot,
                name: item.name || productSnapshot?.name || '',
                code: item.code || productSnapshot?.code || '',
                sku: item.sku || productSnapshot?.sku || '',
                hsn: item.hsn || productSnapshot?.hsn || '',
                category: item.category || productSnapshot?.category || '',
                unit: item.unit || productSnapshot?.unit || 'Nos',
                quantity: Number(item.quantity) || 0,
                rate: rate,
                grossAmount: grossAmount,
                taxableAmount: grossAmount,
                total: grossAmount,
                description: item.description || ''
            });
        }

        const companySnapshot = await companyService.createCompanySnapshot();
        const templateSnapshot = await templateService.getTemplateSnapshot(
            'quotation',
            normalized.templateId
        );

        // Generate quotation number
        const quotationNumber = await this.generateQuotationNumber();

        // Calculate totals using shared calculation engine
        const calculationData = {
            items: items,
            discountType: normalized.discountType || 'none',
            discountValue: Number(normalized.discountValue) || 0,
            gstEnabled: normalized.gstEnabled !== false,
            gstType: normalized.gstType || 'intra',
            gstRate: Number(normalized.gstRate) || 18
        };

        // Use same calculateInvoice function - works for both invoice and quotation
        const calculated = calculationEngine.calculateInvoice(calculationData);

        const updatedItems = items.map((item, index) => ({
            ...item,
            taxableAmount: calculated.items?.[index]?.taxableAmount || item.grossAmount,
            total: calculated.items?.[index]?.total || item.grossAmount
        }));

        // Prepare quotation object
        const now = new Date().toISOString();
        const quotation = {
            id: database.generateId ? database.generateId() : crypto.randomUUID(),
            number: quotationNumber,
            date: normalized.date || new Date().toISOString().split('T')[0],
            validUntil: normalized.validUntil || '',
            customerId: normalized.customerId,
            customerSnapshot: customerSnapshot,
            items: updatedItems,
            reference: normalized.reference || '',
            projectName: normalized.projectName || '',
            quotationType: normalized.quotationType || 'general',
            subtotal: calculated.subtotal,
            discountType: normalized.discountType || 'none',
            discountValue: Number(normalized.discountValue) || 0,
            discountAmount: calculated.discountAmount,
            gstEnabled: normalized.gstEnabled !== false,
            gstType: normalized.gstType || 'intra',
            gstRate: Number(normalized.gstRate) || 18,
            cgst: calculated.cgst || 0,
            sgst: calculated.sgst || 0,
            igst: calculated.igst || 0,
            gstAmount: calculated.gstAmount || 0,
            roundOff: calculated.roundOff || 0,
            grandTotal: calculated.grandTotal || 0,
            status: normalized.status || 'draft',
            templateId: templateSnapshot.templateId,
            templateVersion: templateSnapshot.templateVersion,
            templateSnapshot: templateSnapshot,
            companySnapshot: companySnapshot,
            notes: normalized.notes || '',
            terms: normalized.terms || '',
            convertedToInvoiceId: null,
            createdAt: now,
            updatedAt: now
        };

        await database.add(this._storeName, quotation);

        try {
            const quotations = await database.getAll(this._storeName);
            state.set('quotations', quotations);
            state.set('currentQuotation', quotation);
        } catch (error) {
            console.warn('⚠️ Failed to update quotation state:', error.message);
        }

        await eventBus.emit(
            EVENTS.QUOTATION_CREATED,
            {
                id: quotation.id,
                number: quotation.number,
                grandTotal: quotation.grandTotal,
                data: quotation
            },
            'quotation-service'
        );

        console.log(`📄 Quotation created: ${quotation.number}`);
        return quotation;
    }

    // ============================================================
    // GET QUOTATION
    // ============================================================

    /**
     * Get a quotation by ID
     * @param {string} id - Quotation ID
     * @returns {Promise<Object|null>} - Quotation or null
     */
    async getQuotation(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    /**
     * Get a quotation by number
     * @param {string} number - Quotation number
     * @returns {Promise<Object|null>} - Quotation or null
     */
    async getQuotationByNumber(number) {
        await this.initialize();
        const allQuotations = await database.getAll(this._storeName);
        return allQuotations.find(q => q.number === number) || null;
    }

    // ============================================================
    // GET ALL QUOTATIONS
    // ============================================================

    /**
     * Get all quotations with options
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of quotations
     */
    async getQuotations(options = {}) {
        await this.initialize();

        let quotations = await database.getAll(this._storeName);

        if (options.customerId) {
            quotations = quotations.filter(q => q.customerId === options.customerId);
        }

        if (options.status && options.status !== 'all') {
            quotations = quotations.filter(q => q.status === options.status);
        }

        if (options.quotationType && options.quotationType !== 'all') {
            quotations = quotations.filter(q => q.quotationType === options.quotationType);
        }

        if (options.dateFrom) {
            quotations = quotations.filter(q => q.date >= options.dateFrom);
        }
        if (options.dateTo) {
            quotations = quotations.filter(q => q.date <= options.dateTo);
        }

        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            quotations.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        } else {
            quotations.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        }

        if (options.limit) {
            const offset = options.offset || 0;
            quotations = quotations.slice(offset, offset + options.limit);
        }

        return quotations;
    }

    /**
     * Get quotations by customer ID
     * @param {string} customerId - Customer ID
     * @returns {Promise<Array>} - Array of quotations
     */
    async getQuotationsByCustomer(customerId) {
        return this.getQuotations({ customerId: customerId });
    }

    /**
     * Get quotations by status
     * @param {string} status - Quotation status
     * @returns {Promise<Array>} - Array of quotations
     */
    async getQuotationsByStatus(status) {
        return this.getQuotations({ status: status });
    }

    // ============================================================
    // UPDATE QUOTATION
    // ============================================================

    /**
     * Update an existing quotation
     * @param {string} id - Quotation ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated quotation
     */
    async updateQuotation(id, updates) {
        await this.initialize();

        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Quotation not found: ${id}`);
        }

        if (existing.status === 'converted') {
            throw new Error('Cannot update a converted quotation');
        }

        const merged = { ...existing, ...updates };

        const validation = this.validateQuotation(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const normalized = this.normalizeQuotation(merged);

        // Recalculate using shared calculation engine
        const calculationData = {
            items: normalized.items || [],
            discountType: normalized.discountType || 'none',
            discountValue: Number(normalized.discountValue) || 0,
            gstEnabled: normalized.gstEnabled !== false,
            gstType: normalized.gstType || 'intra',
            gstRate: Number(normalized.gstRate) || 18
        };

        const calculated = calculationEngine.calculateInvoice(calculationData);

        const updatedItems = (normalized.items || []).map((item, index) => ({
            ...item,
            taxableAmount: calculated.items?.[index]?.taxableAmount || item.grossAmount,
            total: calculated.items?.[index]?.total || item.grossAmount
        }));

        const updatedQuotation = {
            ...normalized,
            id: id,
            items: updatedItems,
            subtotal: calculated.subtotal,
            discountAmount: calculated.discountAmount,
            cgst: calculated.cgst || 0,
            sgst: calculated.sgst || 0,
            igst: calculated.igst || 0,
            gstAmount: calculated.gstAmount || 0,
            roundOff: calculated.roundOff || 0,
            grandTotal: calculated.grandTotal || 0,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };

        await database.put(this._storeName, updatedQuotation);

        try {
            const quotations = await database.getAll(this._storeName);
            state.set('quotations', quotations);
            state.set('currentQuotation', updatedQuotation);
        } catch (error) {
            console.warn('⚠️ Failed to update quotation state:', error.message);
        }

        await eventBus.emit(
            EVENTS.QUOTATION_UPDATED,
            {
                id: updatedQuotation.id,
                number: updatedQuotation.number,
                status: updatedQuotation.status,
                data: updatedQuotation
            },
            'quotation-service'
        );

        console.log(`📄 Quotation updated: ${updatedQuotation.number}`);
        return updatedQuotation;
    }

    // ============================================================
    // DELETE QUOTATION (SAFE)
    // ============================================================

    /**
     * Delete a quotation safely
     * @param {string} id - Quotation ID
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     * @returns {Promise<Object>} - Result
     */
    async deleteQuotation(id, confirmation = '') {
        await this.initialize();

        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Quotation deletion requires confirmation. Call deleteQuotation("CONFIRM_DELETE")');
        }

        const quotation = await database.get(this._storeName, id);
        if (!quotation) {
            throw new Error(`Quotation not found: ${id}`);
        }

        if (quotation.status === 'converted' && quotation.convertedToInvoiceId) {
            const invoice = await database.get('invoices', quotation.convertedToInvoiceId);
            if (invoice) {
                throw new Error(
                    `Cannot delete quotation "${quotation.number}" because it has been converted to invoice "${invoice.number}". Delete the invoice first.`
                );
            }
        }

        await database.delete(this._storeName, id);

        try {
            const quotations = await database.getAll(this._storeName);
            state.set('quotations', quotations);
            if (state.get('currentQuotation')?.id === id) {
                state.set('currentQuotation', null);
            }
        } catch (error) {
            console.warn('⚠️ Failed to update quotation state:', error.message);
        }

        await eventBus.emit(
            EVENTS.QUOTATION_DELETED,
            {
                id: quotation.id,
                number: quotation.number,
                data: quotation
            },
            'quotation-service'
        );

        console.log(`📄 Quotation deleted: ${quotation.number}`);
        return { success: true, id: id, number: quotation.number };
    }

    // ============================================================
    // DUPLICATE QUOTATION
    // ============================================================

    /**
     * Duplicate a quotation
     * @param {string} id - Quotation ID to duplicate
     * @returns {Promise<Object>} - Duplicated quotation
     */
    async duplicateQuotation(id) {
        await this.initialize();

        const original = await database.get(this._storeName, id);
        if (!original) {
            throw new Error(`Quotation not found: ${id}`);
        }

        const copy = { ...original };
        delete copy.id;
        delete copy.createdAt;
        delete copy.updatedAt;
        delete copy.number;

        copy.status = 'draft';
        copy.convertedToInvoiceId = null;

        const duplicated = await this.createQuotation(copy);

        console.log(`📄 Quotation duplicated: ${original.number} → ${duplicated.number}`);
        return duplicated;
    }

    // ============================================================
    // CONVERT QUOTATION TO INVOICE
    // ============================================================

    /**
     * Convert a quotation to an invoice
     * @param {string} id - Quotation ID
     * @returns {Promise<Object>} - Created invoice
     */
    async convertQuotationToInvoice(id) {
        await this.initialize();

        const quotation = await database.get(this._storeName, id);
        if (!quotation) {
            throw new Error(`Quotation not found: ${id}`);
        }

        if (quotation.status === 'converted') {
            throw new Error(`Quotation "${quotation.number}" has already been converted to invoice.`);
        }

        // Prepare invoice data from quotation
        const invoiceData = {
            customerId: quotation.customerId,
            customerSnapshot: quotation.customerSnapshot,
            items: quotation.items.map(item => ({
                productId: item.productId,
                productSnapshot: item.productSnapshot,
                name: item.name,
                code: item.code,
                sku: item.sku,
                hsn: item.hsn,
                category: item.category,
                unit: item.unit,
                quantity: item.quantity,
                rate: item.rate,
                grossAmount: item.grossAmount,
                taxableAmount: item.taxableAmount,
                total: item.total,
                description: item.description
            })),
            reference: quotation.reference || `From Quotation ${quotation.number}`,
            discountType: quotation.discountType,
            discountValue: quotation.discountValue,
            gstEnabled: quotation.gstEnabled,
            gstType: quotation.gstType,
            gstRate: quotation.gstRate,
            notes: quotation.notes || '',
            terms: quotation.terms || '',
            templateId: quotation.templateId || 'professional',
            companySnapshot: quotation.companySnapshot
        };

        // Create invoice using invoice service
        const invoice = await invoiceService.createInvoice(invoiceData);

        // Update quotation status
        quotation.status = 'converted';
        quotation.convertedToInvoiceId = invoice.id;
        quotation.updatedAt = new Date().toISOString();
        await database.put(this._storeName, quotation);

        try {
            const quotations = await database.getAll(this._storeName);
            state.set('quotations', quotations);
        } catch (error) {
            console.warn('⚠️ Failed to update quotation state:', error.message);
        }

        // Emit conversion event
        await eventBus.emit(
            EVENTS.QUOTATION_CONVERTED,
            {
                quotationId: quotation.id,
                quotationNumber: quotation.number,
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                data: {
                    quotation: quotation,
                    invoice: invoice
                }
            },
            'quotation-service'
        );

        console.log(`📄 Quotation converted: ${quotation.number} → Invoice ${invoice.invoiceNumber}`);
        return invoice;
    }

    // ============================================================
    // QUOTATION STATUS MANAGEMENT
    // ============================================================

    /**
     * Set quotation status
     * @param {string} id - Quotation ID
     * @param {string} status - New status
     * @returns {Promise<Object>} - Updated quotation
     */
    async setQuotationStatus(id, status) {
        await this.initialize();

        if (!QUOTATION_STATUSES.includes(status)) {
            throw new Error(`Invalid status: ${status}. Available: ${QUOTATION_STATUSES.join(', ')}`);
        }

        const quotation = await database.get(this._storeName, id);
        if (!quotation) {
            throw new Error(`Quotation not found: ${id}`);
        }

        return this.updateQuotation(id, { status: status });
    }

    /**
     * Mark quotation as sent
     * @param {string} id - Quotation ID
     * @returns {Promise<Object>} - Updated quotation
     */
    async sendQuotation(id) {
        return this.setQuotationStatus(id, 'sent');
    }

    /**
     * Accept quotation
     * @param {string} id - Quotation ID
     * @returns {Promise<Object>} - Updated quotation
     */
    async acceptQuotation(id) {
        return this.setQuotationStatus(id, 'accepted');
    }

    /**
     * Expire quotation
     * @param {string} id - Quotation ID
     * @returns {Promise<Object>} - Updated quotation
     */
    async expireQuotation(id) {
        return this.setQuotationStatus(id, 'expired');
    }

    // ============================================================
    // ITEM MANAGEMENT
    // ============================================================

    /**
     * Add an item to a quotation
     * @param {string} quotationId - Quotation ID
     * @param {Object} itemData - Item data
     * @returns {Promise<Object>} - Updated quotation
     */
    async addItem(quotationId, itemData) {
        await this.initialize();

        const quotation = await database.get(this._storeName, quotationId);
        if (!quotation) {
            throw new Error(`Quotation not found: ${quotationId}`);
        }

        if (quotation.status === 'converted') {
            throw new Error('Cannot add items to a converted quotation');
        }

        if (!itemData.productId) {
            throw new Error('Product is required');
        }
        if (!itemData.quantity || itemData.quantity <= 0) {
            throw new Error('Valid quantity is required');
        }

        let productSnapshot = null;
        if (itemData.productId) {
            productSnapshot = await productService.createProductSnapshot(itemData.productId);
        }

        let rate = Number(itemData.rate) || 0;
        if (!rate && itemData.productId) {
            rate = await productService.getProductRate(itemData.productId, itemData.quantity);
        }

        const grossAmount = (Number(itemData.quantity) || 0) * rate;

        const item = {
            productId: itemData.productId,
            productSnapshot: productSnapshot,
            name: itemData.name || productSnapshot?.name || '',
            code: itemData.code || productSnapshot?.code || '',
            sku: itemData.sku || productSnapshot?.sku || '',
            hsn: itemData.hsn || productSnapshot?.hsn || '',
            category: itemData.category || productSnapshot?.category || '',
            unit: itemData.unit || productSnapshot?.unit || 'Nos',
            quantity: Number(itemData.quantity) || 0,
            rate: rate,
            grossAmount: grossAmount,
            taxableAmount: grossAmount,
            total: grossAmount,
            description: itemData.description || ''
        };

        const items = [...(quotation.items || []), item];
        const updatedQuotation = await this.updateQuotation(quotationId, { items });

        console.log(`📄 Item added to quotation: ${item.name}`);
        return updatedQuotation;
    }

    /**
     * Update an item in a quotation
     * @param {string} quotationId - Quotation ID
     * @param {number} itemIndex - Index of item to update
     * @param {Object} updates - Updated item data
     * @returns {Promise<Object>} - Updated quotation
     */
    async updateItem(quotationId, itemIndex, updates) {
        await this.initialize();

        const quotation = await database.get(this._storeName, quotationId);
        if (!quotation) {
            throw new Error(`Quotation not found: ${quotationId}`);
        }

        if (quotation.status === 'converted') {
            throw new Error('Cannot update items in a converted quotation');
        }

        const items = [...(quotation.items || [])];
        if (itemIndex < 0 || itemIndex >= items.length) {
            throw new Error('Invalid item index');
        }

        const currentItem = items[itemIndex];
        const quantity = updates.quantity !== undefined ? Number(updates.quantity) : currentItem.quantity;
        const rate = updates.rate !== undefined ? Number(updates.rate) : currentItem.rate;
        const grossAmount = quantity * rate;

        items[itemIndex] = {
            ...currentItem,
            ...updates,
            quantity: quantity,
            rate: rate,
            grossAmount: grossAmount,
            taxableAmount: grossAmount,
            total: grossAmount
        };

        const updatedQuotation = await this.updateQuotation(quotationId, { items });

        console.log(`📄 Item updated in quotation: ${items[itemIndex].name}`);
        return updatedQuotation;
    }

    /**
     * Remove an item from a quotation
     * @param {string} quotationId - Quotation ID
     * @param {number} itemIndex - Index of item to remove
     * @returns {Promise<Object>} - Updated quotation
     */
    async removeItem(quotationId, itemIndex) {
        await this.initialize();

        const quotation = await database.get(this._storeName, quotationId);
        if (!quotation) {
            throw new Error(`Quotation not found: ${quotationId}`);
        }

        if (quotation.status === 'converted') {
            throw new Error('Cannot remove items from a converted quotation');
        }

        const items = [...(quotation.items || [])];
        if (itemIndex < 0 || itemIndex >= items.length) {
            throw new Error('Invalid item index');
        }

        const removedItem = items.splice(itemIndex, 1)[0];
        const updatedQuotation = await this.updateQuotation(quotationId, { items });

        console.log(`📄 Item removed from quotation: ${removedItem.name}`);
        return updatedQuotation;
    }

    // ============================================================
    // SEARCH QUOTATIONS
    // ============================================================

    /**
     * Search quotations by multiple fields
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Matching quotations
     */
    async searchQuotations(query, options = {}) {
        await this.initialize();

        if (!query || query.trim() === '') {
            return this.getQuotations(options);
        }

        const term = query.toLowerCase().trim();
        let quotations = await database.getAll(this._storeName);

        if (options.customerId) {
            quotations = quotations.filter(q => q.customerId === options.customerId);
        }
        if (options.status && options.status !== 'all') {
            quotations = quotations.filter(q => q.status === options.status);
        }
        if (options.quotationType && options.quotationType !== 'all') {
            quotations = quotations.filter(q => q.quotationType === options.quotationType);
        }

        const results = quotations.filter(quotation => {
            const searchableFields = [
                quotation.number,
                quotation.customerSnapshot?.name,
                quotation.customerSnapshot?.phone,
                quotation.customerSnapshot?.email,
                quotation.customerId,
                quotation.reference,
                quotation.projectName
            ];

            return searchableFields.some(field => {
                if (!field) return false;
                return String(field).toLowerCase().includes(term);
            });
        });

        results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    // ============================================================
    // QUOTATION STATISTICS
    // ============================================================

    /**
     * Get quotation statistics
     * @returns {Promise<Object>} - Quotation statistics
     */
    async getQuotationStats() {
        await this.initialize();

        const quotations = await database.getAll(this._storeName);
        const total = quotations.length;

        const totalAmount = quotations.reduce((sum, q) => sum + (q.grandTotal || 0), 0);
        const byStatus = {};
        const byType = {};

        for (const status of QUOTATION_STATUSES) {
            byStatus[status] = quotations.filter(q => q.status === status).length;
        }

        for (const type of QUOTATION_TYPES) {
            byType[type] = quotations.filter(q => q.quotationType === type).length;
        }

        const converted = quotations.filter(q => q.status === 'converted').length;
        const conversionRate = total > 0 ? (converted / total) * 100 : 0;

        return {
            total: total,
            totalAmount: totalAmount,
            byStatus: byStatus,
            byType: byType,
            converted: converted,
            conversionRate: Math.round(conversionRate * 100) / 100
        };
    }

    /**
     * Count total quotations
     * @returns {Promise<number>}
     */
    async countQuotations() {
        await this.initialize();
        return database.count(this._storeName);
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export quotations to CSV
     * @param {Array} quotations - Quotations to export
     * @returns {string} - CSV string
     */
    exportToCSV(quotations) {
        const headers = [
            'Number', 'Date', 'Valid Until', 'Customer', 'Type',
            'Subtotal', 'Discount', 'GST', 'Grand Total', 'Status', 'Created At'
        ];
        
        const rows = quotations.map(q => [
            q.number || '',
            q.date || '',
            q.validUntil || '',
            q.customerSnapshot?.name || '',
            q.quotationType || 'general',
            q.subtotal || 0,
            q.discountAmount || 0,
            q.gstAmount || 0,
            q.grandTotal || 0,
            q.status || 'draft',
            q.createdAt || ''
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Import quotations from CSV
     * @param {string} csv - CSV string
     * @returns {Promise<Array>} - Imported quotation IDs
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
            const quotation = {};

            for (let j = 0; j < headers.length; j++) {
                const key = headers[j];
                const value = values[j] || '';
                
                if (key === 'Number') quotation.number = value;
                else if (key === 'Date') quotation.date = value;
                else if (key === 'Valid Until') quotation.validUntil = value;
                else if (key === 'Customer') quotation.customerSnapshot = { name: value };
                else if (key === 'Type') quotation.quotationType = value || 'general';
                else if (key === 'Subtotal') quotation.subtotal = parseFloat(value) || 0;
                else if (key === 'Discount') quotation.discountAmount = parseFloat(value) || 0;
                else if (key === 'GST') quotation.gstAmount = parseFloat(value) || 0;
                else if (key === 'Grand Total') quotation.grandTotal = parseFloat(value) || 0;
                else if (key === 'Status') quotation.status = value || 'draft';
            }

            if (!quotation.number) continue;

            try {
                quotation.items = [];
                const created = await this.createQuotation(quotation);
                importedIds.push(created.id);
            } catch (error) {
                console.warn(`Failed to import quotation ${quotation.number}:`, error);
            }
        }

        return importedIds;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const quotationService = new QuotationService();

// ============================================================
// EXPORT
// ============================================================

export { quotationService };
export default quotationService;

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → quotations store
// EVENTS: QUOTATION_CREATED, QUOTATION_UPDATED, 
//         QUOTATION_DELETED, QUOTATION_CONVERTED
// 
// NUMBERING STORE: Compatible with migration.js
// PAYMENT: Not handled here (belongs to payment-service.js)
// CALCULATION: Shared calculationEngine.calculateInvoice()
// 
// FEATURES:
// ✓ Customer Snapshot
// ✓ Product Snapshot
// ✓ Company Snapshot
// ✓ Template Snapshot + Version
// ✓ Invoice-level Discount
// ✓ GST Configuration
// ✓ Calculation Engine Integration
// ✓ Duplicate Quotation
// ✓ Safe Delete
// ✓ Quotation Numbering
// ✓ Events + State Sync
// ✓ Convert to Invoice
// 
// ============================================================