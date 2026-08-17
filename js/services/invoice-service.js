/**
 * H4 Billing ERP - Invoice Service Module
 * Central service for invoice operations
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * invoice-service.js provides a clean API for invoice CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: invoices
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.INVOICE_CREATED
 * - EVENTS.INVOICE_UPDATED
 * - EVENTS.INVOICE_DELETED
 * 
 * ============================================================
 * DEPENDENCIES
 * ============================================================
 * 
 * - database.js
 * - state.js
 * - events.js
 * - customer-service.js
 * - product-service.js
 * - company-service.js
 * - calculation-engine.js
 * 
 * ============================================================
 * GST RULE
 * ============================================================
 * 
 * GST is Invoice-level ONLY.
 * Items do NOT have individual GST rates.
 * GST rates come from invoice settings (0, 5, 7, 9, 18, 28).
 * 
 * ============================================================
 * DISCOUNT RULE
 * ============================================================
 * 
 * Discount is Invoice-level ONLY.
 * Items do NOT have individual discounts.
 * Discount applies to the entire invoice subtotal.
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
 * - Does NOT generate PDF/Print/WhatsApp
 * - Does NOT add GST to Product Master
 * - Does NOT create numbering store (must be in migration.js)
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
import { calculationEngine } from '../engines/calculation-engine.js';

// ============================================================
// CONSTANTS
// ============================================================

const STORE_NAME = 'invoices';
const PAYMENT_STORE_NAME = 'payments';
const NUMBERING_STORE_NAME = 'numbering';

const DISCOUNT_TYPES = ['none', 'percentage', 'flat'];
const GST_TYPES = ['intra', 'inter'];
const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];
const AVAILABLE_GST_RATES = [0, 5, 7, 9, 18, 28];

// ============================================================
// INVOICE SERVICE CLASS
// ============================================================

class InvoiceService {
    constructor() {
        this._storeName = STORE_NAME;
        this._paymentStoreName = PAYMENT_STORE_NAME;
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
        this._initialized = true;
        console.log('🧾 Invoice service initialized');
    }

    // ============================================================
    // GENERATE INVOICE NUMBER
    // ============================================================

    /**
     * Generate the next invoice number
     * Uses numbering store (must be created by migration.js)
     * @returns {Promise<string>} - Next invoice number
     */
    async generateInvoiceNumber() {
        await this.initialize();

        // Get settings for invoice numbering format
        const settings = await database.get('settings', 'settings');
        const numbering = settings?.documentNumbering?.invoice || {
            prefix: 'INV-',
            start: 1,
            padding: 5,
            yearlyReset: false,
            financialYearReset: false
        };

        // Get current numbering state from numbering store
        let numberingState = await database.get(this._numberingStoreName, 'numbering');
        if (!numberingState) {
            // Create default numbering state
            numberingState = {
                id: 'numbering',
                invoice: { current: numbering.start || 1, year: new Date().getFullYear() },
                quotation: { current: 1, year: new Date().getFullYear() },
                payment: { current: 1, year: new Date().getFullYear() },
                updatedAt: new Date().toISOString()
            };
            await database.add(this._numberingStoreName, numberingState);
        }

        const currentYear = new Date().getFullYear();
        let current = numberingState.invoice.current || numbering.start || 1;

        // Check yearly reset
        if (numbering.yearlyReset && numberingState.invoice.year !== currentYear) {
            current = numbering.start || 1;
            numberingState.invoice.year = currentYear;
        }

        // Generate number with padding
        const padded = String(current).padStart(numbering.padding || 5, '0');
        const invoiceNumber = `${numbering.prefix || 'INV-'}${padded}`;

        // Update numbering state
        numberingState.invoice.current = current + 1;
        numberingState.updatedAt = new Date().toISOString();
        await database.put(this._numberingStoreName, numberingState);

        return invoiceNumber;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate invoice data
     * @param {Object} data - Invoice data to validate
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validateInvoice(data) {
        const errors = [];

        // Customer is required
        if (!data.customerId) {
            errors.push('Customer is required');
        }

        // Invoice date is required
        if (!data.invoiceDate) {
            errors.push('Invoice date is required');
        }

        // Items validation
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

        // Discount validation
        if (data.discountType && !DISCOUNT_TYPES.includes(data.discountType)) {
            errors.push(`Invalid discount type: ${data.discountType}`);
        }
        if (data.discountValue !== undefined && data.discountValue < 0) {
            errors.push('Discount value cannot be negative');
        }

        // GST validation
        if (data.gstEnabled) {
            if (data.gstType && !GST_TYPES.includes(data.gstType)) {
                errors.push(`Invalid GST type: ${data.gstType}`);
            }
            if (data.gstRate !== undefined) {
                if (!AVAILABLE_GST_RATES.includes(data.gstRate)) {
                    errors.push(`Invalid GST rate: ${data.gstRate}. Valid rates: ${AVAILABLE_GST_RATES.join(', ')}`);
                }
            }
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
     * Normalize invoice data before saving
     * @param {Object} data - Invoice data to normalize
     * @returns {Object} - Normalized invoice data
     */
    normalizeInvoice(data) {
        const normalized = { ...data };

        // Trim text fields
        if (normalized.notes) normalized.notes = normalized.notes.trim();
        if (normalized.terms) normalized.terms = normalized.terms.trim();
        if (normalized.reference) normalized.reference = normalized.reference.trim();

        // Ensure numeric values
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
        if (normalized.paidAmount !== undefined) normalized.paidAmount = Number(normalized.paidAmount) || 0;
        if (normalized.outstandingAmount !== undefined) normalized.outstandingAmount = Number(normalized.outstandingAmount) || 0;

        // Normalize items
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

        // Default values
        if (!normalized.discountType) normalized.discountType = 'none';
        if (normalized.gstEnabled === undefined) normalized.gstEnabled = true;
        if (!normalized.gstType) normalized.gstType = 'intra';
        if (normalized.gstRate === undefined || normalized.gstRate === null) normalized.gstRate = 18;
        if (!normalized.paymentStatus) normalized.paymentStatus = 'unpaid';
        if (!normalized.templateId) normalized.templateId = 'professional';

        return normalized;
    }

    // ============================================================
    // CREATE INVOICE
    // ============================================================

    /**
     * Create a new invoice
     * @param {Object} data - Invoice data
     * @returns {Promise<Object>} - Created invoice
     */
    async createInvoice(data) {
        await this.initialize();

        // Validate
        const validation = this.validateInvoice(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizeInvoice(data);

        // Get customer snapshot
        let customerSnapshot = null;
        if (normalized.customerId) {
            customerSnapshot = await customerService.createCustomerSnapshot(normalized.customerId);
        }

        // Get product snapshots for items
        const items = [];
        for (const item of normalized.items) {
            let productSnapshot = null;
            if (item.productId) {
                productSnapshot = await productService.createProductSnapshot(item.productId);
            }
            
            // Get product rate if not provided
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
                taxableAmount: grossAmount, // Will be recalculated by calculation engine
                total: grossAmount, // Will be recalculated by calculation engine
                description: item.description || ''
            });
        }

        // Get company snapshot
        const companySnapshot = await companyService.createCompanySnapshot();

        // Generate invoice number
        const invoiceNumber = await this.generateInvoiceNumber();

        // Prepare data for calculation engine
        const calculationData = {
            items: items,
            discountType: normalized.discountType || 'none',
            discountValue: Number(normalized.discountValue) || 0,
            gstEnabled: normalized.gstEnabled !== false,
            gstType: normalized.gstType || 'intra',
            gstRate: Number(normalized.gstRate) || 18
        };

        // Calculate totals using calculation engine
        const calculated = calculationEngine.calculateInvoice(calculationData);

        // Update items with calculated values
        const updatedItems = items.map((item, index) => ({
            ...item,
            taxableAmount: calculated.items?.[index]?.taxableAmount || item.grossAmount,
            total: calculated.items?.[index]?.total || item.grossAmount
        }));

        // Prepare invoice object
        const now = new Date().toISOString();
        const invoice = {
            id: database.generateId ? database.generateId() : crypto.randomUUID(),
            invoiceNumber: invoiceNumber,
            invoiceDate: normalized.invoiceDate || new Date().toISOString().split('T')[0],
            dueDate: normalized.dueDate || '',
            customerId: normalized.customerId,
            customerSnapshot: customerSnapshot,
            items: updatedItems,
            reference: normalized.reference || '',
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
            paymentStatus: 'unpaid',
            paidAmount: 0,
            outstandingAmount: calculated.grandTotal || 0,
            templateId: normalized.templateId || 'professional',
            companySnapshot: companySnapshot,
            notes: normalized.notes || '',
            terms: normalized.terms || '',
            createdAt: now,
            updatedAt: now
        };

        // Save to database
        await database.add(this._storeName, invoice);

        // Update state
        try {
            const invoices = await database.getAll(this._storeName);
            state.set('invoices', invoices);
            state.set('currentInvoice', invoice);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.INVOICE_CREATED,
            {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                grandTotal: invoice.grandTotal,
                data: invoice
            },
            'invoice-service'
        );

        console.log(`🧾 Invoice created: ${invoice.invoiceNumber}`);
        return invoice;
    }

    // ============================================================
    // GET INVOICE
    // ============================================================

    /**
     * Get an invoice by ID
     * @param {string} id - Invoice ID
     * @returns {Promise<Object|null>} - Invoice or null
     */
    async getInvoice(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    /**
     * Get an invoice by invoice number
     * @param {string} invoiceNumber - Invoice number
     * @returns {Promise<Object|null>} - Invoice or null
     */
    async getInvoiceByNumber(invoiceNumber) {
        await this.initialize();
        const allInvoices = await database.getAll(this._storeName);
        return allInvoices.find(inv => inv.invoiceNumber === invoiceNumber) || null;
    }

    // ============================================================
    // GET ALL INVOICES
    // ============================================================

    /**
     * Get all invoices with options
     * @param {Object} options - Query options
     * @param {string} options.customerId - Filter by customer
     * @param {string} options.status - Filter by payment status
     * @param {string} options.dateFrom - Filter by date from
     * @param {string} options.dateTo - Filter by date to
     * @param {string} options.sortBy - Field to sort by
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @param {number} options.limit - Maximum results
     * @param {number} options.offset - Number to skip
     * @returns {Promise<Array>} - Array of invoices
     */
    async getInvoices(options = {}) {
        await this.initialize();

        let invoices = await database.getAll(this._storeName);

        // Filter by customer
        if (options.customerId) {
            invoices = invoices.filter(inv => inv.customerId === options.customerId);
        }

        // Filter by payment status
        if (options.status && options.status !== 'all') {
            invoices = invoices.filter(inv => inv.paymentStatus === options.status);
        }

        // Filter by date range
        if (options.dateFrom) {
            invoices = invoices.filter(inv => inv.invoiceDate >= options.dateFrom);
        }
        if (options.dateTo) {
            invoices = invoices.filter(inv => inv.invoiceDate <= options.dateTo);
        }

        // Sort
        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            invoices.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        } else {
            // Default sort by date desc
            invoices.sort((a, b) => {
                return (b.invoiceDate || '').localeCompare(a.invoiceDate || '');
            });
        }

        // Pagination
        if (options.limit) {
            const offset = options.offset || 0;
            invoices = invoices.slice(offset, offset + options.limit);
        }

        return invoices;
    }

    /**
     * Get invoices by customer ID
     * @param {string} customerId - Customer ID
     * @returns {Promise<Array>} - Array of invoices
     */
    async getInvoicesByCustomer(customerId) {
        return this.getInvoices({ customerId: customerId });
    }

    // ============================================================
    // UPDATE INVOICE
    // ============================================================

    /**
     * Update an existing invoice
     * @param {string} id - Invoice ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated invoice
     */
    async updateInvoice(id, updates) {
        await this.initialize();

        // Get existing invoice
        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Invoice not found: ${id}`);
        }

        // Merge updates with existing
        const merged = { ...existing, ...updates };

        // Validate merged data
        const validation = this.validateInvoice(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizeInvoice(merged);

        // Recalculate if items, discount, or GST changed
        const calculationData = {
            items: normalized.items || [],
            discountType: normalized.discountType || 'none',
            discountValue: Number(normalized.discountValue) || 0,
            gstEnabled: normalized.gstEnabled !== false,
            gstType: normalized.gstType || 'intra',
            gstRate: Number(normalized.gstRate) || 18
        };

        const calculated = calculationEngine.calculateInvoice(calculationData);

        // Update items with calculated values
        const updatedItems = (normalized.items || []).map((item, index) => ({
            ...item,
            taxableAmount: calculated.items?.[index]?.taxableAmount || item.grossAmount,
            total: calculated.items?.[index]?.total || item.grossAmount
        }));

        // Preserve ID and timestamps
        const updatedInvoice = {
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

        // Save to database
        await database.put(this._storeName, updatedInvoice);

        // Update state
        try {
            const invoices = await database.getAll(this._storeName);
            state.set('invoices', invoices);
            state.set('currentInvoice', updatedInvoice);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.INVOICE_UPDATED,
            {
                id: updatedInvoice.id,
                invoiceNumber: updatedInvoice.invoiceNumber,
                data: updatedInvoice
            },
            'invoice-service'
        );

        console.log(`🧾 Invoice updated: ${updatedInvoice.invoiceNumber}`);
        return updatedInvoice;
    }

    // ============================================================
    // DELETE INVOICE
    // ============================================================

    /**
     * Delete an invoice
     * @param {string} id - Invoice ID
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     * @returns {Promise<Object>} - Result
     */
    async deleteInvoice(id, confirmation = '') {
        await this.initialize();

        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Invoice deletion requires confirmation. Call deleteInvoice("CONFIRM_DELETE")');
        }

        // Get invoice before deletion (for event)
        const invoice = await database.get(this._storeName, id);
        if (!invoice) {
            throw new Error(`Invoice not found: ${id}`);
        }

        // Check for payments
        const payments = await database.getByFilter(this._paymentStoreName, { invoiceId: id });
        if (payments && payments.length > 0) {
            throw new Error(`Cannot delete invoice with ${payments.length} payment(s). Delete payments first.`);
        }

        // Delete from database
        await database.delete(this._storeName, id);

        // Update state
        try {
            const invoices = await database.getAll(this._storeName);
            state.set('invoices', invoices);
            if (state.get('currentInvoice')?.id === id) {
                state.set('currentInvoice', null);
            }
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.INVOICE_DELETED,
            {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                data: invoice
            },
            'invoice-service'
        );

        console.log(`🧾 Invoice deleted: ${invoice.invoiceNumber}`);
        return { success: true, id: id, invoiceNumber: invoice.invoiceNumber };
    }

    // ============================================================
    // DUPLICATE INVOICE
    // ============================================================

    /**
     * Duplicate an invoice
     * @param {string} id - Invoice ID to duplicate
     * @returns {Promise<Object>} - Duplicated invoice
     */
    async duplicateInvoice(id) {
        await this.initialize();

        // Get original invoice
        const original = await database.get(this._storeName, id);
        if (!original) {
            throw new Error(`Invoice not found: ${id}`);
        }

        // Create copy without id, createdAt, updatedAt, invoiceNumber
        const copy = {
            ...original
        };

        // Remove fields that should be regenerated
        delete copy.id;
        delete copy.createdAt;
        delete copy.updatedAt;
        delete copy.invoiceNumber;

        // Reset payment fields
        copy.paymentStatus = 'unpaid';
        copy.paidAmount = 0;
        copy.outstandingAmount = copy.grandTotal || 0;

        // Create new invoice using createInvoice (which generates new ID and number)
        const duplicated = await this.createInvoice(copy);

        console.log(`🧾 Invoice duplicated: ${original.invoiceNumber} → ${duplicated.invoiceNumber}`);
        return duplicated;
    }

    // ============================================================
    // ITEM MANAGEMENT
    // ============================================================

    /**
     * Add an item to an invoice
     * @param {string} invoiceId - Invoice ID
     * @param {Object} itemData - Item data
     * @returns {Promise<Object>} - Updated invoice
     */
    async addItem(invoiceId, itemData) {
        await this.initialize();

        // Get existing invoice
        const invoice = await database.get(this._storeName, invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        // Validate item
        if (!itemData.productId) {
            throw new Error('Product is required');
        }
        if (!itemData.quantity || itemData.quantity <= 0) {
            throw new Error('Valid quantity is required');
        }

        // Get product snapshot
        let productSnapshot = null;
        if (itemData.productId) {
            productSnapshot = await productService.createProductSnapshot(itemData.productId);
        }

        // Get product rate if not provided
        let rate = Number(itemData.rate) || 0;
        if (!rate && itemData.productId) {
            rate = await productService.getProductRate(itemData.productId, itemData.quantity);
        }

        const grossAmount = (Number(itemData.quantity) || 0) * rate;

        // Create item
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

        // Add item to invoice
        const items = [...(invoice.items || []), item];
        
        // Update invoice with new items
        const updatedInvoice = await this.updateInvoice(invoiceId, { items });

        console.log(`🧾 Item added to invoice: ${item.name}`);
        return updatedInvoice;
    }

    /**
     * Update an item in an invoice
     * @param {string} invoiceId - Invoice ID
     * @param {number} itemIndex - Index of item to update
     * @param {Object} updates - Updated item data
     * @returns {Promise<Object>} - Updated invoice
     */
    async updateItem(invoiceId, itemIndex, updates) {
        await this.initialize();

        // Get existing invoice
        const invoice = await database.get(this._storeName, invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const items = [...(invoice.items || [])];
        if (itemIndex < 0 || itemIndex >= items.length) {
            throw new Error('Invalid item index');
        }

        // Update item
        const currentItem = items[itemIndex];
        
        // If quantity or rate changed, recalculate gross
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

        // Update invoice with updated items
        const updatedInvoice = await this.updateInvoice(invoiceId, { items });

        console.log(`🧾 Item updated in invoice: ${items[itemIndex].name}`);
        return updatedInvoice;
    }

    /**
     * Remove an item from an invoice
     * @param {string} invoiceId - Invoice ID
     * @param {number} itemIndex - Index of item to remove
     * @returns {Promise<Object>} - Updated invoice
     */
    async removeItem(invoiceId, itemIndex) {
        await this.initialize();

        // Get existing invoice
        const invoice = await database.get(this._storeName, invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const items = [...(invoice.items || [])];
        if (itemIndex < 0 || itemIndex >= items.length) {
            throw new Error('Invalid item index');
        }

        const removedItem = items.splice(itemIndex, 1)[0];

        // Update invoice with remaining items
        const updatedInvoice = await this.updateInvoice(invoiceId, { items });

        console.log(`🧾 Item removed from invoice: ${removedItem.name}`);
        return updatedInvoice;
    }

    // ============================================================
    // PAYMENT STATUS
    // ============================================================

    /**
     * Get payment status for an invoice
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Object>} - Payment status
     */
    async getInvoicePaymentStatus(invoiceId) {
        await this.initialize();

        const invoice = await database.get(this._storeName, invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        // Get payments for this invoice
        const payments = await database.getByFilter(this._paymentStoreName, { invoiceId: invoiceId });
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        const grandTotal = invoice.grandTotal || 0;
        const outstanding = Math.max(0, grandTotal - totalPaid);

        let status = 'unpaid';
        if (totalPaid >= grandTotal && grandTotal > 0) {
            status = 'paid';
        } else if (totalPaid > 0 && totalPaid < grandTotal) {
            status = 'partial';
        }

        return {
            invoiceId: invoiceId,
            grandTotal: grandTotal,
            paidAmount: totalPaid,
            outstandingAmount: outstanding,
            status: status,
            paymentCount: payments.length
        };
    }

    /**
     * Update invoice payment status
     * @param {string} invoiceId - Invoice ID
     * @returns {Promise<Object>} - Updated invoice
     */
    async updateInvoicePaymentStatus(invoiceId) {
        await this.initialize();

        const paymentStatus = await this.getInvoicePaymentStatus(invoiceId);
        
        const updates = {
            paymentStatus: paymentStatus.status,
            paidAmount: paymentStatus.paidAmount,
            outstandingAmount: paymentStatus.outstandingAmount
        };

        return this.updateInvoice(invoiceId, updates);
    }

    // ============================================================
    // SEARCH INVOICES
    // ============================================================

    /**
     * Search invoices by multiple fields
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Matching invoices
     */
    async searchInvoices(query, options = {}) {
        await this.initialize();

        if (!query || query.trim() === '') {
            return this.getInvoices(options);
        }

        const term = query.toLowerCase().trim();
        let invoices = await database.getAll(this._storeName);

        // Apply filters
        if (options.customerId) {
            invoices = invoices.filter(inv => inv.customerId === options.customerId);
        }
        if (options.status && options.status !== 'all') {
            invoices = invoices.filter(inv => inv.paymentStatus === options.status);
        }

        // Search in fields
        const results = invoices.filter(invoice => {
            const searchableFields = [
                invoice.invoiceNumber,
                invoice.customerSnapshot?.name,
                invoice.customerSnapshot?.phone,
                invoice.customerSnapshot?.email,
                invoice.customerId,
                invoice.reference
            ];

            return searchableFields.some(field => {
                if (!field) return false;
                return String(field).toLowerCase().includes(term);
            });
        });

        // Sort by date desc
        results.sort((a, b) => {
            return (b.invoiceDate || '').localeCompare(a.invoiceDate || '');
        });

        // Limit
        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    // ============================================================
    // INVOICE STATISTICS
    // ============================================================

    /**
     * Get invoice statistics
     * @returns {Promise<Object>} - Invoice statistics
     */
    async getInvoiceStats() {
        await this.initialize();

        const invoices = await database.getAll(this._storeName);
        const total = invoices.length;

        const totalAmount = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
        const totalPaid = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.outstandingAmount || 0), 0);

        const byStatus = {
            unpaid: invoices.filter(inv => inv.paymentStatus === 'unpaid').length,
            partial: invoices.filter(inv => inv.paymentStatus === 'partial').length,
            paid: invoices.filter(inv => inv.paymentStatus === 'paid').length
        };

        return {
            total: total,
            totalAmount: totalAmount,
            totalPaid: totalPaid,
            totalOutstanding: totalOutstanding,
            byStatus: byStatus
        };
    }

    /**
     * Count total invoices
     * @returns {Promise<number>}
     */
    async countInvoices() {
        await this.initialize();
        return database.count(this._storeName);
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export invoices to CSV
     * @param {Array} invoices - Invoices to export
     * @returns {string} - CSV string
     */
    exportToCSV(invoices) {
        const headers = [
            'Invoice Number', 'Date', 'Due Date', 'Customer', 'Subtotal',
            'Discount', 'GST', 'Grand Total', 'Payment Status', 'Created At'
        ];
        
        const rows = invoices.map(inv => [
            inv.invoiceNumber || '',
            inv.invoiceDate || '',
            inv.dueDate || '',
            inv.customerSnapshot?.name || '',
            inv.subtotal || 0,
            inv.discountAmount || 0,
            inv.gstAmount || 0,
            inv.grandTotal || 0,
            inv.paymentStatus || 'unpaid',
            inv.createdAt || ''
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Import invoices from CSV
     * @param {string} csv - CSV string
     * @returns {Promise<Array>} - Imported invoice IDs
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
            const invoice = {};

            for (let j = 0; j < headers.length; j++) {
                const key = headers[j];
                const value = values[j] || '';
                
                if (key === 'Invoice Number') invoice.invoiceNumber = value;
                else if (key === 'Date') invoice.invoiceDate = value;
                else if (key === 'Due Date') invoice.dueDate = value;
                else if (key === 'Customer') invoice.customerSnapshot = { name: value };
                else if (key === 'Subtotal') invoice.subtotal = parseFloat(value) || 0;
                else if (key === 'Discount') invoice.discountAmount = parseFloat(value) || 0;
                else if (key === 'GST') invoice.gstAmount = parseFloat(value) || 0;
                else if (key === 'Grand Total') invoice.grandTotal = parseFloat(value) || 0;
                else if (key === 'Payment Status') invoice.paymentStatus = value || 'unpaid';
            }

            // Skip empty rows
            if (!invoice.invoiceNumber) continue;

            try {
                invoice.items = [];
                const created = await this.createInvoice(invoice);
                importedIds.push(created.id);
            } catch (error) {
                console.warn(`Failed to import invoice ${invoice.invoiceNumber}:`, error);
            }
        }

        return importedIds;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const invoiceService = new InvoiceService();

// ============================================================
// EXPORT
// ============================================================

export { invoiceService };
export default invoiceService;

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → invoices store
// EVENTS: INVOICE_CREATED, INVOICE_UPDATED, INVOICE_DELETED
// 
// GST: Invoice-level ONLY - NO item-level GST
// DISCOUNT: Invoice-level ONLY - NO item-level discount
// NUMBERING: Uses numbering store (must be in migration.js)
// 
// CALCULATION ENGINE: Fully integrated
// 
// FUNCTIONS:
// - createInvoice()
// - getInvoice()
// - getInvoices()
// - updateInvoice()
// - deleteInvoice()
// - duplicateInvoice()
// - addItem()
// - updateItem()
// - removeItem()
// - getInvoicePaymentStatus()
// - updateInvoicePaymentStatus()
// - searchInvoices()
// - getInvoiceStats()
// - countInvoices()
// - exportToCSV()
// - importFromCSV()
// 
// ============================================================