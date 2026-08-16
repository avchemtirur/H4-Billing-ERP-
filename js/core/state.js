/**
 * H4 Billing ERP - State Management Module
 * Central in-memory application state manager
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * state.js manages the CURRENT APPLICATION STATE in memory.
 * It does NOT store permanent data - that belongs to IndexedDB.
 * 
 * ============================================================
 * WHAT IT DOES
 * ============================================================
 * 
 * - Application state (current module, route, loading, DB ready)
 * - Company state
 * - Customer state (loaded list, selected)
 * - Product state (loaded list, selected)
 * - Invoice state (current, items, totals, draft)
 * - Quotation state (current, items, totals, draft)
 * - Template state (available, selected)
 * - Payment state
 * - UI state (theme, modal, toast, sidebar)
 * - State change notifications (subscribe/unsubscribe)
 * - Safe state updates (no direct mutation)
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB
 * - Does NOT define database structure
 * - Does NOT perform CRUD operations (services do that)
 * - Does NOT calculate GST/discounts/totals (calculation-engine does that)
 * - Does NOT contain business logic
 * - Does NOT render UI
 * - Does NOT create or modify databases
 * - Does NOT replace permanent data storage
 * 
 * ============================================================
 * DATA FLOW
 * ============================================================
 * 
 * database.js (opens IndexedDB)
 *     ↓
 * h4:database-ready event
 *     ↓
 * state.js (databaseReady = true)
 *     ↓
 * service modules load data from IndexedDB
 *     ↓
 * service modules update state
 *     ↓
 * UI components read state
 * ============================================================
 */

// ============================================================
// INITIAL STATE
// ============================================================

const INITIAL_STATE = {
    // ============================================================
    // APPLICATION STATE
    // ============================================================
    currentModule: 'dashboard',
    currentRoute: '#/',
    databaseReady: false,
    appLoading: false,
    appError: null,
    appInitialized: false,

    // ============================================================
    // COMPANY STATE
    // ============================================================
    company: null,
    companyLoading: false,
    companyError: null,

    // ============================================================
    // CUSTOMER STATE
    // ============================================================
    customers: [],
    selectedCustomer: null,
    customerSearch: '',
    customerLoading: false,
    customerError: null,
    customerPagination: {
        page: 1,
        limit: 20,
        total: 0
    },

    // ============================================================
    // PRODUCT STATE
    // ============================================================
    products: [],
    selectedProduct: null,
    productSearch: '',
    productCategoryFilter: 'all',
    productLoading: false,
    productError: null,
    productPagination: {
        page: 1,
        limit: 20,
        total: 0
    },

    // ============================================================
    // INVOICE STATE
    // ============================================================
    currentInvoice: null,
    invoiceItems: [],
    selectedInvoiceCustomer: null,
    invoiceTotals: null,
    invoiceDraft: null,
    invoiceLoading: false,
    invoiceError: null,
    invoiceStatus: 'draft',

    // ============================================================
    // INVOICE DRAFT - Preserves current invoice work
    // ============================================================
    invoiceDraftData: {
        customerId: null,
        customerSnapshot: null,
        date: null,
        dueDate: null,
        reference: '',
        paymentTerms: '',
        items: [],
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0,
        gstEnabled: true,
        gstType: 'intra',
        customerGstin: '',
        notes: '',
        terms: '',
        templateId: 'professional',
        warrantyEnabled: false,
        warrantyType: 'standard',
        warrantyPeriod: '',
        warrantyTerms: ''
    },

    // ============================================================
    // QUOTATION STATE
    // ============================================================
    currentQuotation: null,
    quotationItems: [],
    selectedQuotationCustomer: null,
    quotationTotals: null,
    quotationDraft: null,
    quotationLoading: false,
    quotationError: null,
    quotationStatus: 'draft',

    // ============================================================
    // QUOTATION DRAFT - Preserves current quotation work
    // ============================================================
    quotationDraftData: {
        customerId: null,
        customerSnapshot: null,
        date: null,
        validUntil: null,
        reference: '',
        projectName: '',
        quotationType: 'general',
        items: [],
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0,
        gstEnabled: true,
        gstType: 'intra',
        customerGstin: '',
        notes: '',
        terms: '',
        templateId: 'quotation-professional',
        warrantyEnabled: false,
        warrantyType: 'standard',
        warrantyPeriod: '',
        warrantyTerms: ''
    },

    // ============================================================
    // PAYMENT STATE
    // ============================================================
    payments: [],
    selectedPayment: null,
    paymentSearch: '',
    paymentLoading: false,
    paymentError: null,
    paymentPagination: {
        page: 1,
        limit: 20,
        total: 0
    },

    // ============================================================
    // TEMPLATE STATE
    // ============================================================
    templates: [],
    selectedInvoiceTemplate: null,
    selectedQuotationTemplate: null,
    templateLoading: false,
    templateError: null,

    // ============================================================
    // SETTINGS STATE
    // ============================================================
    settings: null,
    settingsLoading: false,
    settingsError: null,

    // ============================================================
    // UI STATE
    // ============================================================
    theme: 'system',
    accentColor: 'purple',
    uiScale: 100,
    sidebarOpen: false,
    modalOpen: false,
    modalData: null,
    modalType: null,
    toast: {
        message: null,
        type: 'info',
        duration: 3000,
        visible: false
    },
    loading: false,
    error: null,
    activeTab: null
};

// ============================================================
// STATE MANAGER CLASS
// ============================================================

class StateManager {
    constructor() {
        this._state = this._cloneState(INITIAL_STATE);
        this._listeners = new Map();
        this._listenerIdCounter = 0;
        this._batchUpdates = [];
        this._isBatching = false;
        this._frozen = false;
    }

    // ============================================================
    // CORE STATE OPERATIONS
    // ============================================================

    /**
     * Get the entire state or a specific path
     * @param {string} path - Dot notation path (e.g., 'invoiceItems')
     * @returns {any} - The state value
     */
    get(path = null) {
        if (!path) {
            return this._cloneState(this._state);
        }

        const parts = path.split('.');
        let value = this._state;

        for (const part of parts) {
            if (value === undefined || value === null) {
                return undefined;
            }
            value = value[part];
        }

        return value;
    }

    /**
     * Set state value with change tracking
     * @param {string} path - Dot notation path
     * @param {any} value - New value
     * @param {boolean} silent - Skip event emission
     * @returns {boolean} - Whether state changed
     */
    set(path, value, silent = false) {
        if (this._frozen) {
            console.warn('⚠️ State is frozen, update ignored');
            return false;
        }

        const parts = path.split('.');
        const lastKey = parts.pop();
        let target = this._state;

        // Navigate to parent
        for (const part of parts) {
            if (!target[part] || typeof target[part] !== 'object') {
                target[part] = {};
            }
            target = target[part];
        }

        // Check if value changed
        const oldValue = target[lastKey];
        const newValue = typeof value === 'object' && value !== null
            ? this._cloneState(value)
            : value;

        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
            return false;
        }

        // Set new value
        target[lastKey] = newValue;

        // Notify listeners
        if (!silent) {
            this._notifyListeners(path, oldValue, newValue);
        }

        return true;
    }

    /**
     * Update state with a function
     * @param {string} path - Dot notation path
     * @param {Function} updater - Function that receives current value and returns new value
     * @returns {boolean} - Whether state changed
     */
    update(path, updater) {
        if (this._frozen) {
            console.warn('⚠️ State is frozen, update ignored');
            return false;
        }

        const current = this.get(path);
        const result = updater(current);
        return this.set(path, result);
    }

    /**
     * Batch multiple state updates
     * @param {Function} callback - Function that receives the state manager
     * @returns {Array} - Changed paths
     */
    batch(callback) {
        if (this._frozen) {
            console.warn('⚠️ State is frozen, batch ignored');
            return [];
        }

        this._isBatching = true;
        const changedPaths = [];

        try {
            callback(this);
            this._isBatching = false;

            // Process batched updates
            for (const update of this._batchUpdates) {
                const changed = this.set(update.path, update.value, true);
                if (changed) {
                    changedPaths.push(update.path);
                }
            }
            this._batchUpdates = [];

            // Emit batch events
            if (changedPaths.length > 0) {
                this._notifyListeners('*', null, this._state);
            }
        } catch (error) {
            this._isBatching = false;
            this._batchUpdates = [];
            throw error;
        }

        return changedPaths;
    }

    // ============================================================
    // STATE RESET
    // ============================================================

    /**
     * Reset specific state section to initial defaults
     * @param {string} path - Specific path to reset, or null for all
     */
    reset(path = null) {
        if (path) {
            const parts = path.split('.');
            let target = this._state;
            let parent = null;
            let lastKey = null;

            for (const part of parts) {
                parent = target;
                lastKey = part;
                target = target[part];
                if (!target) break;
            }

            if (parent && lastKey) {
                const defaultState = this._cloneState(INITIAL_STATE);
                let defaultValue = defaultState;
                for (const part of parts) {
                    defaultValue = defaultValue[part];
                    if (!defaultValue) break;
                }
                if (defaultValue !== undefined) {
                    parent[lastKey] = this._cloneState(defaultValue);
                    this._notifyListeners(path, null, parent[lastKey]);
                }
            }
        } else {
            this._state = this._cloneState(INITIAL_STATE);
            this._notifyListeners('*', null, this._state);
        }
    }

    /**
     * Reset invoice state only
     */
    resetInvoiceState() {
        this.set('currentInvoice', null);
        this.set('invoiceItems', []);
        this.set('selectedInvoiceCustomer', null);
        this.set('invoiceTotals', null);
        this.set('invoiceDraft', null);
        this.set('invoiceLoading', false);
        this.set('invoiceError', null);
        this.set('invoiceStatus', 'draft');
        this.set('invoiceDraftData', this._cloneState(INITIAL_STATE.invoiceDraftData));
    }

    /**
     * Reset quotation state only
     */
    resetQuotationState() {
        this.set('currentQuotation', null);
        this.set('quotationItems', []);
        this.set('selectedQuotationCustomer', null);
        this.set('quotationTotals', null);
        this.set('quotationDraft', null);
        this.set('quotationLoading', false);
        this.set('quotationError', null);
        this.set('quotationStatus', 'draft');
        this.set('quotationDraftData', this._cloneState(INITIAL_STATE.quotationDraftData));
    }

    /**
     * Reset customer state only
     */
    resetCustomerState() {
        this.set('customers', []);
        this.set('selectedCustomer', null);
        this.set('customerSearch', '');
        this.set('customerLoading', false);
        this.set('customerError', null);
        this.set('customerPagination', { page: 1, limit: 20, total: 0 });
    }

    /**
     * Reset product state only
     */
    resetProductState() {
        this.set('products', []);
        this.set('selectedProduct', null);
        this.set('productSearch', '');
        this.set('productCategoryFilter', 'all');
        this.set('productLoading', false);
        this.set('productError', null);
        this.set('productPagination', { page: 1, limit: 20, total: 0 });
    }

    /**
     * Reset payment state only
     */
    resetPaymentState() {
        this.set('payments', []);
        this.set('selectedPayment', null);
        this.set('paymentSearch', '');
        this.set('paymentLoading', false);
        this.set('paymentError', null);
        this.set('paymentPagination', { page: 1, limit: 20, total: 0 });
    }

    /**
     * Reset UI state only
     */
    resetUIState() {
        this.set('modalOpen', false);
        this.set('modalData', null);
        this.set('modalType', null);
        this.set('toast', { message: null, type: 'info', duration: 3000, visible: false });
        this.set('loading', false);
        this.set('error', null);
    }

    // ============================================================
    // STATE FREEZE / UNFREEZE
    // ============================================================

    /**
     * Freeze state updates (useful during critical operations)
     */
    freeze() {
        this._frozen = true;
    }

    /**
     * Unfreeze state updates
     */
    unfreeze() {
        this._frozen = false;
    }

    /**
     * Check if state is frozen
     * @returns {boolean}
     */
    isFrozen() {
        return this._frozen;
    }

    // ============================================================
    // SUBSCRIPTION SYSTEM
    // ============================================================

    /**
     * Subscribe to state changes
     * @param {Function} callback - Function called on state change
     * @param {string} path - Specific path to listen to (or '*' for all)
     * @param {Object} options - { immediate: boolean }
     * @returns {Function} - Unsubscribe function
     */
    subscribe(callback, path = '*', options = {}) {
        if (typeof callback !== 'function') {
            throw new Error('Subscribe callback must be a function');
        }

        const id = ++this._listenerIdCounter;
        const listener = {
            id,
            callback,
            path,
            immediate: options.immediate || false
        };

        if (!this._listeners.has(path)) {
            this._listeners.set(path, []);
        }
        this._listeners.get(path).push(listener);

        // Immediate callback with current value
        if (listener.immediate) {
            try {
                const value = this.get(path === '*' ? null : path);
                callback(value, undefined, path);
            } catch (error) {
                console.error('Error in immediate state listener:', error);
            }
        }

        // Return unsubscribe function
        return () => {
            const listeners = this._listeners.get(path);
            if (listeners) {
                const index = listeners.findIndex(l => l.id === id);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
                if (listeners.length === 0) {
                    this._listeners.delete(path);
                }
            }
        };
    }

    /**
     * Unsubscribe from state changes
     * @param {Function} callback - The callback function to remove
     * @param {string} path - Specific path to unsubscribe from
     */
    unsubscribe(callback, path = '*') {
        const listeners = this._listeners.get(path);
        if (listeners) {
            const index = listeners.findIndex(l => l.callback === callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
            if (listeners.length === 0) {
                this._listeners.delete(path);
            }
        }
    }

    /**
     * Notify listeners of state change
     * @param {string} path - Changed path
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     */
    _notifyListeners(path, oldValue, newValue) {
        // Notify specific path listeners
        const specificListeners = this._listeners.get(path);
        if (specificListeners) {
            for (const listener of specificListeners) {
                try {
                    listener.callback(newValue, oldValue, path);
                } catch (error) {
                    console.error('Error in state listener:', error);
                }
            }
        }

        // Notify wildcard listeners
        const wildcardListeners = this._listeners.get('*');
        if (wildcardListeners) {
            for (const listener of wildcardListeners) {
                try {
                    listener.callback(newValue, oldValue, path);
                } catch (error) {
                    console.error('Error in wildcard listener:', error);
                }
            }
        }

        // Dispatch DOM event for cross-module communication
        try {
            window.dispatchEvent(
                new CustomEvent('h4:state-changed', {
                    detail: {
                        path,
                        oldValue: oldValue !== undefined ? this._cloneState(oldValue) : undefined,
                        newValue: newValue !== undefined ? this._cloneState(newValue) : undefined,
                        timestamp: new Date().toISOString()
                    }
                })
            );
        } catch (error) {
            // Ignore DOM event errors
        }
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    /**
     * Get state snapshot
     * @param {string} path - Specific path to snapshot
     * @returns {any} - Deep cloned state
     */
    snapshot(path = null) {
        return this.get(path);
    }

    /**
     * Get state statistics
     * @returns {Object}
     */
    getStats() {
        const size = JSON.stringify(this._state).length;
        const listenerCount = Array.from(this._listeners.values()).reduce(
            (sum, listeners) => sum + listeners.length, 0
        );

        return {
            size: size,
            formattedSize: this._formatSize(size),
            listenerCount: listenerCount,
            pathCount: this._countPaths(this._state),
            frozen: this._frozen
        };
    }

    /**
     * Count total paths in state
     * @param {Object} obj - Object to count paths in
     * @param {string} prefix - Current path prefix
     * @returns {number}
     */
    _countPaths(obj, prefix = '') {
        let count = 0;
        for (const key in obj) {
            if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && obj[key] !== null) {
                count += this._countPaths(obj[key], prefix ? `${prefix}.${key}` : key);
            }
            count++;
        }
        return count;
    }

    /**
     * Format size
     * @param {number} bytes - Size in bytes
     * @returns {string}
     */
    _formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    /**
     * Deep clone an object
     * @param {any} obj - Object to clone
     * @returns {any}
     */
    _cloneState(obj) {
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (typeof obj !== 'object') {
            return obj;
        }
        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this._cloneState(item));
        }
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = this._cloneState(obj[key]);
            }
        }
        return cloned;
    }

    /**
     * Get current state as JSON
     * @returns {string}
     */
    toJSON() {
        return JSON.stringify(this._state, null, 2);
    }

    /**
     * Load state from JSON
     * @param {string} json - JSON string
     * @returns {boolean}
     */
    fromJSON(json) {
        try {
            const parsed = JSON.parse(json);
            this._state = this._cloneState(parsed);
            this._notifyListeners('*', null, this._state);
            return true;
        } catch (error) {
            console.error('Failed to load state from JSON:', error);
            return false;
        }
    }

    // ============================================================
    // DATABASE READY STATE
    // ============================================================

    /**
     * Set database ready state
     * @param {boolean} ready - Whether database is ready
     */
    setDatabaseReady(ready) {
        this.set('databaseReady', ready);
        if (ready) {
            console.log('📊 State: Database marked as ready');
        }
    }

    /**
     * Check if database is ready
     * @returns {boolean}
     */
    isDatabaseReady() {
        return this.get('databaseReady') === true;
    }

    // ============================================================
    // INVOICE DRAFT OPERATIONS
    // ============================================================

    /**
     * Save current invoice draft
     * Preserves all invoice data for recovery
     */
    saveInvoiceDraft() {
        const draftData = {
            customerId: this.get('selectedInvoiceCustomer'),
            customerSnapshot: this.get('selectedInvoiceCustomer'),
            date: this.get('invoiceDraftData.date'),
            dueDate: this.get('invoiceDraftData.dueDate'),
            reference: this.get('invoiceDraftData.reference'),
            paymentTerms: this.get('invoiceDraftData.paymentTerms'),
            items: this.get('invoiceItems'),
            discountType: this.get('invoiceDraftData.discountType'),
            discountValue: this.get('invoiceDraftData.discountValue'),
            discountAmount: this.get('invoiceDraftData.discountAmount'),
            gstEnabled: this.get('invoiceDraftData.gstEnabled'),
            gstType: this.get('invoiceDraftData.gstType'),
            customerGstin: this.get('invoiceDraftData.customerGstin'),
            notes: this.get('invoiceDraftData.notes'),
            terms: this.get('invoiceDraftData.terms'),
            templateId: this.get('invoiceDraftData.templateId'),
            warrantyEnabled: this.get('invoiceDraftData.warrantyEnabled'),
            warrantyType: this.get('invoiceDraftData.warrantyType'),
            warrantyPeriod: this.get('invoiceDraftData.warrantyPeriod'),
            warrantyTerms: this.get('invoiceDraftData.warrantyTerms')
        };

        this.set('invoiceDraft', draftData);
        return draftData;
    }

    /**
     * Restore invoice draft
     * @returns {Object|null} - Restored draft or null
     */
    restoreInvoiceDraft() {
        const draft = this.get('invoiceDraft');
        if (!draft) {
            return null;
        }

        // Restore each field
        if (draft.customerId) {
            this.set('selectedInvoiceCustomer', draft.customerId);
        }
        if (draft.customerSnapshot) {
            this.set('selectedInvoiceCustomer', draft.customerSnapshot);
        }
        if (draft.date) {
            this.set('invoiceDraftData.date', draft.date);
        }
        if (draft.dueDate) {
            this.set('invoiceDraftData.dueDate', draft.dueDate);
        }
        if (draft.reference) {
            this.set('invoiceDraftData.reference', draft.reference);
        }
        if (draft.paymentTerms) {
            this.set('invoiceDraftData.paymentTerms', draft.paymentTerms);
        }
        if (draft.items && draft.items.length > 0) {
            this.set('invoiceItems', draft.items);
        }
        if (draft.discountType) {
            this.set('invoiceDraftData.discountType', draft.discountType);
        }
        if (draft.discountValue !== undefined) {
            this.set('invoiceDraftData.discountValue', draft.discountValue);
        }
        if (draft.discountAmount !== undefined) {
            this.set('invoiceDraftData.discountAmount', draft.discountAmount);
        }
        if (draft.gstEnabled !== undefined) {
            this.set('invoiceDraftData.gstEnabled', draft.gstEnabled);
        }
        if (draft.gstType) {
            this.set('invoiceDraftData.gstType', draft.gstType);
        }
        if (draft.customerGstin !== undefined) {
            this.set('invoiceDraftData.customerGstin', draft.customerGstin);
        }
        if (draft.notes !== undefined) {
            this.set('invoiceDraftData.notes', draft.notes);
        }
        if (draft.terms !== undefined) {
            this.set('invoiceDraftData.terms', draft.terms);
        }
        if (draft.templateId) {
            this.set('invoiceDraftData.templateId', draft.templateId);
        }
        if (draft.warrantyEnabled !== undefined) {
            this.set('invoiceDraftData.warrantyEnabled', draft.warrantyEnabled);
        }
        if (draft.warrantyType) {
            this.set('invoiceDraftData.warrantyType', draft.warrantyType);
        }
        if (draft.warrantyPeriod) {
            this.set('invoiceDraftData.warrantyPeriod', draft.warrantyPeriod);
        }
        if (draft.warrantyTerms) {
            this.set('invoiceDraftData.warrantyTerms', draft.warrantyTerms);
        }

        return draft;
    }

    /**
     * Clear invoice draft
     */
    clearInvoiceDraft() {
        this.set('invoiceDraft', null);
    }

    /**
     * Check if invoice draft exists
     * @returns {boolean}
     */
    hasInvoiceDraft() {
        return this.get('invoiceDraft') !== null;
    }

    // ============================================================
    // QUOTATION DRAFT OPERATIONS
    // ============================================================

    /**
     * Save current quotation draft
     * Preserves all quotation data for recovery
     */
    saveQuotationDraft() {
        const draftData = {
            customerId: this.get('selectedQuotationCustomer'),
            customerSnapshot: this.get('selectedQuotationCustomer'),
            date: this.get('quotationDraftData.date'),
            validUntil: this.get('quotationDraftData.validUntil'),
            reference: this.get('quotationDraftData.reference'),
            projectName: this.get('quotationDraftData.projectName'),
            quotationType: this.get('quotationDraftData.quotationType'),
            items: this.get('quotationItems'),
            discountType: this.get('quotationDraftData.discountType'),
            discountValue: this.get('quotationDraftData.discountValue'),
            discountAmount: this.get('quotationDraftData.discountAmount'),
            gstEnabled: this.get('quotationDraftData.gstEnabled'),
            gstType: this.get('quotationDraftData.gstType'),
            customerGstin: this.get('quotationDraftData.customerGstin'),
            notes: this.get('quotationDraftData.notes'),
            terms: this.get('quotationDraftData.terms'),
            templateId: this.get('quotationDraftData.templateId'),
            warrantyEnabled: this.get('quotationDraftData.warrantyEnabled'),
            warrantyType: this.get('quotationDraftData.warrantyType'),
            warrantyPeriod: this.get('quotationDraftData.warrantyPeriod'),
            warrantyTerms: this.get('quotationDraftData.warrantyTerms')
        };

        this.set('quotationDraft', draftData);
        return draftData;
    }

    /**
     * Restore quotation draft
     * @returns {Object|null} - Restored draft or null
     */
    restoreQuotationDraft() {
        const draft = this.get('quotationDraft');
        if (!draft) {
            return null;
        }

        // Restore each field
        if (draft.customerId) {
            this.set('selectedQuotationCustomer', draft.customerId);
        }
        if (draft.customerSnapshot) {
            this.set('selectedQuotationCustomer', draft.customerSnapshot);
        }
        if (draft.date) {
            this.set('quotationDraftData.date', draft.date);
        }
        if (draft.validUntil) {
            this.set('quotationDraftData.validUntil', draft.validUntil);
        }
        if (draft.reference) {
            this.set('quotationDraftData.reference', draft.reference);
        }
        if (draft.projectName) {
            this.set('quotationDraftData.projectName', draft.projectName);
        }
        if (draft.quotationType) {
            this.set('quotationDraftData.quotationType', draft.quotationType);
        }
        if (draft.items && draft.items.length > 0) {
            this.set('quotationItems', draft.items);
        }
        if (draft.discountType) {
            this.set('quotationDraftData.discountType', draft.discountType);
        }
        if (draft.discountValue !== undefined) {
            this.set('quotationDraftData.discountValue', draft.discountValue);
        }
        if (draft.discountAmount !== undefined) {
            this.set('quotationDraftData.discountAmount', draft.discountAmount);
        }
        if (draft.gstEnabled !== undefined) {
            this.set('quotationDraftData.gstEnabled', draft.gstEnabled);
        }
        if (draft.gstType) {
            this.set('quotationDraftData.gstType', draft.gstType);
        }
        if (draft.customerGstin !== undefined) {
            this.set('quotationDraftData.customerGstin', draft.customerGstin);
        }
        if (draft.notes !== undefined) {
            this.set('quotationDraftData.notes', draft.notes);
        }
        if (draft.terms !== undefined) {
            this.set('quotationDraftData.terms', draft.terms);
        }
        if (draft.templateId) {
            this.set('quotationDraftData.templateId', draft.templateId);
        }
        if (draft.warrantyEnabled !== undefined) {
            this.set('quotationDraftData.warrantyEnabled', draft.warrantyEnabled);
        }
        if (draft.warrantyType) {
            this.set('quotationDraftData.warrantyType', draft.warrantyType);
        }
        if (draft.warrantyPeriod) {
            this.set('quotationDraftData.warrantyPeriod', draft.warrantyPeriod);
        }
        if (draft.warrantyTerms) {
            this.set('quotationDraftData.warrantyTerms', draft.warrantyTerms);
        }

        return draft;
    }

    /**
     * Clear quotation draft
     */
    clearQuotationDraft() {
        this.set('quotationDraft', null);
    }

    /**
     * Check if quotation draft exists
     * @returns {boolean}
     */
    hasQuotationDraft() {
        return this.get('quotationDraft') !== null;
    }

    // ============================================================
    // CONVENIENCE METHODS
    // ============================================================

    /**
     * Set loading state
     * @param {boolean} loading - Loading status
     * @param {string} module - Optional module name
     */
    setLoading(loading, module = null) {
        if (module) {
            this.set(`${module}Loading`, loading);
        }
        this.set('loading', loading);
    }

    /**
     * Set error state
     * @param {string} error - Error message
     * @param {string} module - Optional module name
     */
    setError(error, module = null) {
        if (module) {
            this.set(`${module}Error`, error);
        }
        this.set('error', error);
        this.set('appError', error);
    }

    /**
     * Clear error state
     * @param {string} module - Optional module name
     */
    clearError(module = null) {
        if (module) {
            this.set(`${module}Error`, null);
        }
        this.set('error', null);
        this.set('appError', null);
    }

    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (info, success, warning, error)
     * @param {number} duration - Duration in milliseconds
     */
    showToast(message, type = 'info', duration = 3000) {
        this.set('toast', {
            message,
            type,
            duration,
            visible: true
        });

        // Auto-hide toast after duration
        if (duration > 0) {
            setTimeout(() => {
                this.hideToast();
            }, duration);
        }
    }

    /**
     * Hide toast notification
     */
    hideToast() {
        this.set('toast', {
            ...this.get('toast'),
            visible: false
        });
    }

    /**
     * Open modal
     * @param {string} type - Modal type
     * @param {any} data - Modal data
     */
    openModal(type, data = null) {
        this.set('modalOpen', true);
        this.set('modalType', type);
        this.set('modalData', data);
    }

    /**
     * Close modal
     */
    closeModal() {
        this.set('modalOpen', false);
        this.set('modalType', null);
        this.set('modalData', null);
    }

    /**
     * Toggle sidebar
     */
    toggleSidebar() {
        this.set('sidebarOpen', !this.get('sidebarOpen'));
    }

    /**
     * Set theme
     * @param {string} theme - Theme name (light, dark, system)
     */
    setTheme(theme) {
        this.set('theme', theme);
    }

    /**
     * Set accent color
     * @param {string} color - Accent color name
     */
    setAccentColor(color) {
        this.set('accentColor', color);
    }

    /**
     * Set UI scale
     * @param {number} scale - UI scale percentage
     */
    setUIScale(scale) {
        this.set('uiScale', scale);
    }

    /**
     * Set current module
     * @param {string} module - Module name
     */
    setCurrentModule(module) {
        this.set('currentModule', module);
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const state = new StateManager();

// ============================================================
// LISTEN FOR DATABASE READY EVENT
// ============================================================

// Listen for database ready event from database.js
window.addEventListener('h4:database-ready', (event) => {
    const { name, version, isReady } = event.detail || {};
    console.log(`📊 State: Database ${name} v${version} is ready`);
    state.setDatabaseReady(true);
    state.set('appInitialized', true);
    state.set('appLoading', false);
});

// ============================================================
// EXPORT
// ============================================================

export { state };
export default state;

// ============================================================
// USAGE EXAMPLES
// ============================================================

/*
// ============================================================
// BASIC USAGE
// ============================================================

import state from './state.js';

// Get state
const customers = state.get('customers');
const currentModule = state.get('currentModule');

// Set state
state.set('currentModule', 'invoice');
state.set('selectedCustomer', customerData);

// Update state with function
state.update('invoiceItems', (items) => {
    return [...items, newItem];
});

// Batch updates
state.batch((s) => {
    s.set('selectedCustomer', customer);
    s.set('customers', updatedList);
    s.set('customerLoading', false);
});


// ============================================================
// SUBSCRIBE TO STATE CHANGES
// ============================================================

// Subscribe to specific path
const unsubscribe = state.subscribe(
    (newValue, oldValue, path) => {
        console.log(`State changed: ${path}`, newValue);
    },
    'customers'
);

// Unsubscribe
unsubscribe();

// Subscribe to all changes
state.subscribe((newState, oldState, path) => {
    console.log('State changed:', path);
}, '*');


// ============================================================
// INVOICE DRAFT
// ============================================================

// Save draft before leaving page
state.saveInvoiceDraft();

// Restore draft when returning
const draft = state.restoreInvoiceDraft();
if (draft) {
    console.log('Restored invoice draft:', draft);
}


// ============================================================
// UI HELPERS
// ============================================================

// Show toast
state.showToast('Invoice saved successfully', 'success');

// Open modal
state.openModal('add-customer', { type: 'new' });

// Set theme
state.setTheme('dark');


// ============================================================
// RESET STATE
// ============================================================

// Reset specific module
state.resetInvoiceState();
state.resetQuotationState();

// Reset all state
state.reset();


// ============================================================
// CHECK DATABASE READY
// ============================================================

if (state.isDatabaseReady()) {
    console.log('Database is ready, loading data...');
} else {
    console.log('Waiting for database...');
}
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// WHAT IT DOES:
// - Manages current application state in memory
// - Preserves invoice and quotation drafts
// - Notifies subscribers of state changes
// - Provides safe state update methods
// 
// WHAT IT DOES NOT DO:
// - Does NOT open IndexedDB
// - Does NOT perform CRUD operations
// - Does NOT calculate GST/discounts
// - Does NOT contain business logic
// - Does NOT render UI
// 
// CONNECTIONS:
// - Listens for h4:database-ready event
// - Services update state after CRUD operations
// - UI components read state for rendering
// - Calculation engine reads state for calculations
// 
// DRAFT PROTECTION:
// - Invoice drafts are preserved when opening new customer/product
// - Quotation drafts are preserved similarly
// - Drafts survive module transitions
// 
// ============================================================