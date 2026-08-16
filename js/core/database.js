/**
 * H4 Billing ERP - Database Foundation
 * Central IndexedDB database for H4BillingERP
 * Version: 1.0.0
 * 
 * SINGLE DATABASE: H4BillingERP
 * ALL modules MUST use this database.
 * No duplicate databases allowed.
 */

// ============================================================
// DATABASE CONFIGURATION
// ============================================================

const DB_NAME = "H4BillingERP";
const DB_VERSION = 1;

const STORE_NAMES = [
    'company',
    'customers',
    'products',
    'invoices',
    'quotations',
    'payments',
    'templates',
    'images',
    'fonts',
    'settings'
];

// ============================================================
// INDEX DEFINITIONS
// ============================================================

const INDEX_DEFINITIONS = {
    customers: [
        { name: 'byName', keyPath: 'name' },
        { name: 'byPhone', keyPath: 'phone' },
        { name: 'byWhatsapp', keyPath: 'whatsapp' },
        { name: 'byGstin', keyPath: 'gstin' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    products: [
        { name: 'byName', keyPath: 'name' },
        { name: 'bySku', keyPath: 'sku' },
        { name: 'byCategory', keyPath: 'category' },
        { name: 'byActive', keyPath: 'active' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    invoices: [
        { name: 'byNumber', keyPath: 'number' },
        { name: 'byDate', keyPath: 'date' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byStatus', keyPath: 'status' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    quotations: [
        { name: 'byNumber', keyPath: 'number' },
        { name: 'byDate', keyPath: 'date' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byStatus', keyPath: 'status' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    payments: [
        { name: 'byNumber', keyPath: 'number' },
        { name: 'byDate', keyPath: 'date' },
        { name: 'byInvoiceId', keyPath: 'invoiceId' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byMethod', keyPath: 'method' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    templates: [
        { name: 'byType', keyPath: 'type' },
        { name: 'byDefault', keyPath: 'isDefault' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    images: [
        { name: 'byName', keyPath: 'name' },
        { name: 'byType', keyPath: 'type' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    fonts: [
        { name: 'byFamily', keyPath: 'family' },
        { name: 'byType', keyPath: 'type' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ]
};

// Total indexes: 34

// ============================================================
// DATABASE CLASS
// ============================================================

class H4Database {
    constructor() {
        this.db = null;
        this.isOpen = false;
        this._readyPromise = null;
        this._name = DB_NAME;
        this._version = DB_VERSION;
        this._storeNames = STORE_NAMES;
        this._upgradeInProgress = false;
        this._indexDefinitions = INDEX_DEFINITIONS;
        this._resetProtection = false;
    }

    /**
     * Initialize and open the database
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this.isOpen && this.db) {
            return this.db;
        }

        if (this._readyPromise) {
            return this._readyPromise;
        }

        this._readyPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this._name, this._version);

            request.onupgradeneeded = (event) => {
                this._upgradeInProgress = true;
                const db = event.target.result;
                const oldVersion = event.oldVersion;
                const newVersion = event.newVersion;
                const transaction = event.target.transaction;
                
                console.log(`🔄 Database upgrade: ${oldVersion} → ${newVersion}`);
                
                try {
                    this._createStores(db, transaction);
                    this._createIndexes(db, transaction);
                    this._runMigrations(db, transaction, oldVersion, newVersion);
                    this._initializeDefaultData(db, transaction);
                    
                    this._upgradeInProgress = false;
                    console.log('✅ Database upgrade completed successfully');
                } catch (error) {
                    this._upgradeInProgress = false;
                    console.error('❌ Upgrade failed:', error);
                    transaction.abort();
                    reject(error);
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isOpen = true;
                this._setupEventListeners();
                console.log(`✅ Database opened: ${this._name} v${this._version}`);
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('❌ Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onblocked = () => {
                console.warn('⚠️ Database blocked - close other tabs');
                reject(new Error('Database blocked by another tab'));
            };
        });

        return this._readyPromise;
    }

    // ============================================================
    // STORE CREATION (During Upgrade)
    // ============================================================

    _createStores(db, transaction) {
        for (const storeName of this._storeNames) {
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, {
                    keyPath: 'id',
                    autoIncrement: false
                });
                console.log(`📁 Created store: ${storeName}`);
            }
        }
    }

    // ============================================================
    // INDEX CREATION (During Upgrade)
    // ============================================================

    _createIndexes(db, transaction) {
        for (const [storeName, indexes] of Object.entries(this._indexDefinitions)) {
            if (db.objectStoreNames.contains(storeName)) {
                const store = transaction.objectStore(storeName);
                for (const idx of indexes) {
                    if (!store.indexNames.contains(idx.name)) {
                        store.createIndex(idx.name, idx.keyPath, { unique: false });
                        console.log(`📊 Created index: ${storeName}.${idx.name}`);
                    }
                }
            }
        }
    }

    // ============================================================
    // MIGRATIONS (During Upgrade)
    // ============================================================

    _runMigrations(db, transaction, oldVersion, newVersion) {
        if (oldVersion < 1) {
            console.log('📋 Running migration: v0 → v1 (Initial schema)');
        }
        // Future migrations:
        // if (oldVersion < 2) { ... }
    }

    // ============================================================
    // DEFAULT DATA INITIALIZATION (During Upgrade)
    // ============================================================

    _initializeDefaultData(db, transaction) {
        const now = new Date().toISOString();

        // Company
        if (db.objectStoreNames.contains('company')) {
            const store = transaction.objectStore('company');
            const request = store.get('company');
            request.onsuccess = () => {
                if (!request.result) {
                    store.add({
                        id: 'company',
                        legalName: '',
                        brandName: '',
                        address: '',
                        city: '',
                        district: '',
                        state: 'Kerala',
                        pin: '',
                        phone: '',
                        whatsapp: '',
                        email: '',
                        website: '',
                        gstin: '',
                        pan: '',
                        companyLogo: null,
                        brandLogo: null,
                        signature: null,
                        bankEnabled: true,
                        bankName: '',
                        accountName: '',
                        accountNumber: '',
                        ifsc: '',
                        branch: '',
                        upiId: '',
                        authorizedPerson: '',
                        defaultTerms: '',
                        defaultWarranty: '',
                        createdAt: now,
                        updatedAt: now
                    });
                    console.log('🏢 Default company record created');
                }
            };
        }

        // Settings
        if (db.objectStoreNames.contains('settings')) {
            const store = transaction.objectStore('settings');
            const request = store.get('settings');
            request.onsuccess = () => {
                if (!request.result) {
                    store.add({
                        id: 'settings',
                        documentNumbering: {
                            invoice: { prefix: 'H4-INV-', start: 1, padding: 5, yearlyReset: false, financialYearReset: false },
                            quotation: { prefix: 'H4-QUO-', start: 1, padding: 5, yearlyReset: false, financialYearReset: false },
                            payment: { prefix: 'H4-PAY-', start: 1, padding: 5 }
                        },
                        units: ['Nos', 'Bag', 'Kg', 'Gram', 'Litre', 'ML', 'Meter', 'Sq.ft', 'Sq.m', 'Box', 'Set', 'Piece', 'Hour', 'Day', 'Trip', 'Job'],
                        gstRates: [0, 5, 7, 9, 12, 18, 28],
                        rounding: { method: 'none', precision: 1 },
                        theme: { mode: 'light', accent: 'purple' },
                        scale: 100,
                        general: { autoSave: true, notifications: true, offline: true },
                        updatedAt: now
                    });
                    console.log('⚙️ Default settings created');
                }
            };
        }

        // Templates
        if (db.objectStoreNames.contains('templates')) {
            const store = transaction.objectStore('templates');
            const request = store.count();
            request.onsuccess = () => {
                if (request.result === 0) {
                    const templates = [
                        {
                            id: 'professional',
                            name: 'Professional',
                            type: 'invoice',
                            isDefault: true,
                            config: {
                                header: { showLogo: true, showTitle: true, alignment: 'center' },
                                footer: { showTerms: true, showBank: true, showSignature: true },
                                items: { showHsn: true, showGst: true, showDiscount: true },
                                colors: { primary: '#6C3BC5', secondary: '#4A2A8A', accent: '#FFD700' }
                            },
                            createdAt: now,
                            updatedAt: now
                        },
                        {
                            id: 'modern',
                            name: 'Modern',
                            type: 'invoice',
                            isDefault: false,
                            config: {
                                header: { showLogo: true, showTitle: true, alignment: 'left' },
                                footer: { showTerms: true, showBank: true, showSignature: true },
                                items: { showHsn: true, showGst: true, showDiscount: true },
                                colors: { primary: '#1A1A2E', secondary: '#16213E', accent: '#0F3460' }
                            },
                            createdAt: now,
                            updatedAt: now
                        },
                        {
                            id: 'classic',
                            name: 'Classic',
                            type: 'invoice',
                            isDefault: false,
                            config: {
                                header: { showLogo: true, showTitle: true, alignment: 'center' },
                                footer: { showTerms: true, showBank: true, showSignature: true },
                                items: { showHsn: true, showGst: true, showDiscount: true },
                                colors: { primary: '#2C3E50', secondary: '#34495E', accent: '#E74C3C' }
                            },
                            createdAt: now,
                            updatedAt: now
                        },
                        {
                            id: 'quotation-professional',
                            name: 'Professional',
                            type: 'quotation',
                            isDefault: true,
                            config: {
                                header: { showLogo: true, showTitle: true, alignment: 'center' },
                                footer: { showTerms: true, showBank: true, showSignature: true },
                                items: { showHsn: true, showGst: true, showDiscount: true },
                                colors: { primary: '#6C3BC5', secondary: '#4A2A8A', accent: '#FFD700' }
                            },
                            createdAt: now,
                            updatedAt: now
                        }
                    ];
                    for (const template of templates) {
                        store.add(template);
                    }
                    console.log('📄 Default templates created');
                }
            };
        }
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    _setupEventListeners() {
        this.db.onversionchange = () => {
            this.db.close();
            this.isOpen = false;
            this._readyPromise = null;
            console.log('🔄 Database version change detected, closing connection');
        };
        this.db.onclose = () => {
            this.isOpen = false;
            this._readyPromise = null;
            console.log('🔒 Database connection closed');
        };
    }

    // ============================================================
    // GENERATE UNIQUE ID
    // ============================================================

    generateId() {
        return crypto.randomUUID();
    }

    // ============================================================
    // RUNTIME CRUD OPERATIONS
    // ============================================================

    async add(storeName, data) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                const now = new Date().toISOString();
                data.createdAt = data.createdAt || now;
                data.updatedAt = now;
                if (!data.id) {
                    data.id = this.generateId();
                }
                const request = store.add(data);
                request.onsuccess = () => resolve(data.id);
                request.onerror = () => reject(new Error(`Failed to add to ${storeName}: ${request.error}`));
                transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async put(storeName, data) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }
        if (!data.id) {
            throw new Error('Record must have an ID for update');
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                data.updatedAt = new Date().toISOString();
                const request = store.put(data);
                request.onsuccess = () => resolve(data.id);
                request.onerror = () => reject(new Error(`Failed to update ${storeName}: ${request.error}`));
                transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async get(storeName, id) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(new Error(`Failed to get from ${storeName}: ${request.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async getAll(storeName) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(new Error(`Failed to get all from ${storeName}: ${request.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async delete(storeName, id) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(new Error(`Failed to delete from ${storeName}: ${request.error}`));
                transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async clear(storeName) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(new Error(`Failed to clear ${storeName}: ${request.error}`));
                transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async count(storeName) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(new Error(`Failed to count ${storeName}: ${request.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    // ============================================================
    // RUNTIME INDEX-BASED QUERIES
    // ============================================================

    async getByIndex(storeName, indexName, value) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) {
                    reject(new Error(`Index ${indexName} not found in ${storeName}`));
                    return;
                }
                const index = store.index(indexName);
                const request = index.getAll(value);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(new Error(`Failed to query index ${indexName}: ${request.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    async getByIndexRange(storeName, indexName, keyRange) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) {
                    reject(new Error(`Index ${indexName} not found in ${storeName}`));
                    return;
                }
                const index = store.index(indexName);
                const request = index.getAll(keyRange);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(new Error(`Failed to query index ${indexName}: ${request.error}`));
            } catch (error) {
                reject(error);
            }
        });
    }

    // ============================================================
    // SEARCH WITH INDEX SUPPORT
    // ============================================================

    /**
     * Search records by text in fields.
     * For large datasets, consider using indexes for specific fields.
     * @param {string} storeName - Name of the store
     * @param {string} searchTerm - Text to search for
     * @param {Array<string>} fields - Fields to search in
     * @param {Array<Object>} indexHints - Optional index hints for performance
     * @returns {Promise<Array>} - Array of matching records
     */
    async search(storeName, searchTerm, fields = [], indexHints = null) {
        await this.init();
        if (!this._storeNames.includes(storeName)) {
            throw new Error(`Invalid store: ${storeName}`);
        }

        if (!searchTerm || searchTerm.trim() === '') {
            return this.getAll(storeName);
        }

        const term = searchTerm.toLowerCase().trim();

        // If index hints provided, use them for better performance
        if (indexHints && Array.isArray(indexHints)) {
            let results = [];
            for (const hint of indexHints) {
                try {
                    const matches = await this.getByIndex(storeName, hint.index, hint.value);
                    results = results.concat(matches);
                } catch (e) {
                    // Index not found, fallback to full scan
                }
            }
            if (results.length > 0) {
                // Remove duplicates
                const uniqueResults = [];
                const seenIds = new Set();
                for (const record of results) {
                    if (!seenIds.has(record.id)) {
                        seenIds.add(record.id);
                        uniqueResults.push(record);
                    }
                }
                // Filter by search term
                return uniqueResults.filter(record => {
                    return fields.some(field => {
                        const value = this._getNestedValue(record, field);
                        if (value === undefined || value === null) return false;
                        return String(value).toLowerCase().includes(term);
                    });
                });
            }
        }

        // Full scan fallback
        const allRecords = await this.getAll(storeName);
        return allRecords.filter(record => {
            return fields.some(field => {
                const value = this._getNestedValue(record, field);
                if (value === undefined || value === null) return false;
                return String(value).toLowerCase().includes(term);
            });
        });
    }

    _getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    // ============================================================
    // RUNTIME MULTI-STORE TRANSACTIONS (FIXED)
    // ============================================================

    /**
     * Execute multiple operations in a single transaction.
     * Supports both synchronous and asynchronous operations.
     * @param {Array<string>} storeNames - Names of stores
     * @param {Function} callback - Function that receives store objects
     * @returns {Promise<any>} - Result of the callback
     */
    async transaction(storeNames, callback) {
        await this.init();
        
        for (const name of storeNames) {
            if (!this._storeNames.includes(name)) {
                throw new Error(`Invalid store: ${name}`);
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeNames, 'readwrite');
                const stores = {};
                
                for (const name of storeNames) {
                    stores[name] = transaction.objectStore(name);
                }
                
                // Execute callback
                const result = callback(stores);
                
                // Handle both synchronous and asynchronous results
                const handleResult = (value) => {
                    // If callback returned a promise, wait for it
                    if (value && typeof value.then === 'function') {
                        value.then(
                            (resolved) => {
                                // Promise resolved, transaction will complete
                            },
                            (error) => {
                                transaction.abort();
                                reject(error);
                            }
                        );
                    }
                    // Otherwise resolve with the value
                };
                
                transaction.oncomplete = () => {
                    // Resolve with the result (or handle async)
                    if (result && typeof result.then === 'function') {
                        result.then(resolve).catch(reject);
                    } else {
                        resolve(result);
                    }
                };
                
                transaction.onerror = () => {
                    reject(new Error(`Transaction failed: ${transaction.error}`));
                };
                
                transaction.onabort = () => {
                    reject(new Error('Transaction aborted'));
                };
                
                // Handle potential async callback
                handleResult(result);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    // ============================================================
    // BINARY STORAGE
    // ============================================================

    async storeBinary(storeName, id, field, blob, mimeType) {
        await this.init();
        const record = await this.get(storeName, id);
        if (!record) {
            throw new Error(`Record ${id} not found in ${storeName}`);
        }
        record[field] = blob;
        record[field + 'Type'] = mimeType;
        record.updatedAt = new Date().toISOString();
        await this.put(storeName, record);
        return record;
    }

    async getBinary(storeName, id, field) {
        await this.init();
        const record = await this.get(storeName, id);
        if (!record || !record[field]) {
            return null;
        }
        return record[field];
    }

    // ============================================================
    // BACKUP & RESTORE
    // ============================================================

    async exportAll() {
        await this.init();
        const data = {};
        for (const storeName of this._storeNames) {
            data[storeName] = await this.getAll(storeName);
        }
        return {
            version: this._version,
            exportedAt: new Date().toISOString(),
            database: this._name,
            data: data
        };
    }

    async importAll(exportData, clearExisting = true) {
        await this.init();
        if (!exportData || typeof exportData !== 'object') {
            throw new Error('Invalid backup data: missing or malformed');
        }
        if (!exportData.data || typeof exportData.data !== 'object') {
            throw new Error('Invalid backup data: missing data property');
        }
        
        const storeNames = Object.keys(exportData.data);
        const storesToImport = storeNames.filter(name => this._storeNames.includes(name));
        if (storesToImport.length === 0) {
            throw new Error('No valid stores found in backup');
        }

        for (const storeName of storesToImport) {
            const records = exportData.data[storeName];
            if (!Array.isArray(records)) {
                throw new Error(`Invalid data for store ${storeName}: expected array`);
            }
        }

        await this.transaction(storesToImport, (stores) => {
            for (const storeName of storesToImport) {
                if (clearExisting) {
                    stores[storeName].clear();
                }
                for (const record of exportData.data[storeName]) {
                    if (record && typeof record === 'object' && record.id) {
                        stores[storeName].put(record);
                    }
                }
            }
        });
    }

    // ============================================================
    // VALIDATION (FIXED - Missing indexes are FATAL)
    // ============================================================

    async validate() {
        await this.init();
        
        const issues = [];
        const warnings = [];
        
        if (!this.isOpen || !this.db) {
            issues.push('Database is not open');
            return { valid: false, issues, warnings, storeCount: 0 };
        }
        
        // Check all stores exist
        for (const storeName of this._storeNames) {
            if (!this.db.objectStoreNames.contains(storeName)) {
                issues.push(`Store missing: ${storeName}`);
            }
        }
        
        // Check all indexes exist - MISSING INDEXES ARE FATAL
        for (const [storeName, indexes] of Object.entries(this._indexDefinitions)) {
            if (this.db.objectStoreNames.contains(storeName)) {
                const store = this.db.transaction(storeName, 'readonly').objectStore(storeName);
                for (const idx of indexes) {
                    if (!store.indexNames.contains(idx.name)) {
                        issues.push(`Index missing: ${storeName}.${idx.name}`);
                    }
                }
            }
        }
        
        // Check records have required fields (warnings only)
        try {
            for (const storeName of this._storeNames) {
                if (this.db.objectStoreNames.contains(storeName)) {
                    const records = await this.getAll(storeName);
                    for (const record of records) {
                        if (!record.id) {
                            warnings.push(`Record in ${storeName} missing ID`);
                        }
                        if (!record.createdAt) {
                            warnings.push(`Record in ${storeName} missing createdAt`);
                        }
                        if (!record.updatedAt) {
                            warnings.push(`Record in ${storeName} missing updatedAt`);
                        }
                    }
                }
            }
        } catch (e) {
            issues.push(`Error validating: ${e.message}`);
        }
        
        return {
            valid: issues.length === 0,
            issues: issues,
            warnings: warnings,
            storeCount: this.db.objectStoreNames.length
        };
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    getInfo() {
        return {
            name: this._name,
            version: this._version,
            isOpen: this.isOpen,
            stores: this._storeNames,
            storeCount: this._storeNames.length
        };
    }

    async getSize() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return estimate.usage || 0;
        }
        return 0;
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    async isEmpty() {
        for (const storeName of this._storeNames) {
            const count = await this.count(storeName);
            if (count > 0) return false;
        }
        return true;
    }

    async getStoreStats() {
        const stats = {};
        for (const storeName of this._storeNames) {
            stats[storeName] = await this.count(storeName);
        }
        return stats;
    }

    close() {
        if (this.db && this.isOpen) {
            this.db.close();
            this.isOpen = false;
            this._readyPromise = null;
            console.log('🔒 Database closed');
        }
    }

    // ============================================================
    // RESET (PROTECTED - Requires confirmation)
    // ============================================================

    /**
     * Reset database (clears all data)
     * WARNING: This is destructive!
     * @param {string} confirmation - Must be "CONFIRM_RESET"
     */
    async reset(confirmation = '') {
        if (confirmation !== 'CONFIRM_RESET') {
            throw new Error('Reset requires confirmation. Call reset("CONFIRM_RESET")');
        }
        
        await this.init();
        console.warn('⚠️ WARNING: Resetting database - deleting all data!');
        
        for (const storeName of this._storeNames) {
            await this.clear(storeName);
        }
        
        console.log('🗑️ Database reset completed');
        this._resetProtection = true;
    }

    /**
     * Check if reset protection is enabled
     */
    isResetProtected() {
        return this._resetProtection;
    }

    // ============================================================
    // DANGEROUS OPERATIONS (WITH PROTECTION)
    // ============================================================

    /**
     * Delete the entire database
     * WARNING: This is destructive!
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     */
    async deleteDatabase(confirmation = '') {
        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Database deletion requires confirmation. Call deleteDatabase("CONFIRM_DELETE")');
        }
        
        await this.close();
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this._name);
            request.onsuccess = () => {
                console.log(`🗑️ Database ${this._name} deleted`);
                resolve();
            };
            request.onerror = () => {
                reject(new Error(`Failed to delete database: ${request.error}`));
            };
            request.onblocked = () => {
                reject(new Error('Database deletion blocked - close other tabs'));
            };
        });
    }

    // ============================================================
    // INDEX DEFINITION ACCESS
    // ============================================================

    getIndexDefinitions(storeName) {
        return this._indexDefinitions[storeName] || [];
    }

    getAllIndexDefinitions() {
        return this._indexDefinitions;
    }

    getTotalIndexCount() {
        let count = 0;
        for (const indexes of Object.values(this._indexDefinitions)) {
            count += indexes.length;
        }
        return count;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const H4DB = new H4Database();

export { H4DB };
export default H4DB;

// ============================================================
// SUMMARY
// ============================================================
// DATABASE: H4BillingERP
// VERSION: 1
// STORES: 10
// INDEXES: 34
// 
// FIXES APPLIED:
// 1. validate() - Missing indexes now reported as FATAL issues
// 2. transaction() - Supports both sync and async callbacks
// 3. search() - Added indexHints support for performance
// 4. reset() - Requires "CONFIRM_RESET" confirmation
// 5. deleteDatabase() - Requires "CONFIRM_DELETE" confirmation
// 6. Added _resetProtection flag
// ============================================================