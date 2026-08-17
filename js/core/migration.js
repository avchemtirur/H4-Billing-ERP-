/**
 * H4 Billing ERP - Migration Module
 * Handles database schema migrations during upgrade
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * migration.js is called by database.js during onupgradeneeded.
 * It receives the upgrade transaction and performs schema changes.
 * 
 * ============================================================
 * ARCHITECTURE
 * ============================================================
 * 
 * database.js
 *     ↓
 * indexedDB.open()
 *     ↓
 * onupgradeneeded
 *     ↓
 * migrateDatabase(db, transaction, oldVersion, newVersion)
 *     ↓
 * ┌─────────────────────────────────────────────────┐
 * │  migration.js                                  │
 * │  ├── Create Stores (11 stores)                 │
 * │  │   company, customers, products, invoices,   │
 * │  │   quotations, payments, templates, images,  │
 * │  │   fonts, settings, numbering                │
 * │  ├── Create Indexes (35 indexes)               │
 * │  ├── Migrate Old Data (if needed)              │
 * │  └── Seed Default Data                         │
 * └─────────────────────────────────────────────────┘
 *     ↓
 * transaction commit
 *     ↓
 * database.js onsuccess
 *     ↓
 * h4:database-ready
 * 
 * ============================================================
 * IMPORTANT
 * ============================================================
 * 
 * - migration.js does NOT call indexedDB.open()
 * - migration.js does NOT define DB_NAME or DB_VERSION
 * - migration.js does NOT dispatch events
 * - migration.js uses ONLY the provided upgrade transaction
 * - Schema creation uses transaction.objectStore()
 * - Runtime CRUD uses db.transaction() - these are separate
 * - Never clear existing data during migration
 * - Never overwrite existing user data
 * - Index creation checks for existence first
 * - Field names must match service expectations
 * ============================================================
 */

// ============================================================
// STORE DEFINITIONS
// ============================================================

/**
 * All stores are created with:
 * - keyPath: 'id' - Every record has a unique 'id' field
 * - autoIncrement: false - IDs are generated using crypto.randomUUID()
 * 
 * EXACTLY 11 STORES - DO NOT ADD OR REMOVE WITHOUT UPDATING SERVICES
 * 
 * Stores:
 * 1. company      - Company profile
 * 2. customers    - Customer master
 * 3. products     - Product master
 * 4. invoices     - Invoice records
 * 5. quotations   - Quotation records
 * 6. payments     - Payment records
 * 7. templates    - Document templates
 * 8. images       - Image storage
 * 9. fonts        - Font storage
 * 10. settings    - Application settings
 * 11. numbering   - Document numbering (invoice, quotation, payment)
 */
const STORE_DEFINITIONS = {
    company: { keyPath: 'id', autoIncrement: false },
    customers: { keyPath: 'id', autoIncrement: false },
    products: { keyPath: 'id', autoIncrement: false },
    invoices: { keyPath: 'id', autoIncrement: false },
    quotations: { keyPath: 'id', autoIncrement: false },
    payments: { keyPath: 'id', autoIncrement: false },
    templates: { keyPath: 'id', autoIncrement: false },
    images: { keyPath: 'id', autoIncrement: false },
    fonts: { keyPath: 'id', autoIncrement: false },
    settings: { keyPath: 'id', autoIncrement: false },
    numbering: { keyPath: 'id', autoIncrement: false }
};

// ============================================================
// INDEX DEFINITIONS - TOTAL: 35 INDEXES
// ============================================================

/**
 * All indexes are created with:
 * - unique: false - Multiple records can have the same value
 * - Indexes improve query performance for search and filtering
 * 
 * INDEX COUNT: 35
 * customers: 5
 * products: 5
 * invoices: 5
 * quotations: 5
 * payments: 6
 * templates: 3
 * images: 3
 * fonts: 3
 * TOTAL: 35
 * 
 * IMPORTANT: Index names must match service expectations
 */
const INDEX_DEFINITIONS = {
    // ============================================================
    // CUSTOMERS INDEXES - 5 indexes
    // ============================================================
    customers: [
        { name: 'byName', keyPath: 'name' },
        { name: 'byPhone', keyPath: 'phone' },
        { name: 'byWhatsapp', keyPath: 'whatsapp' },
        { name: 'byGstin', keyPath: 'gstin' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // PRODUCTS INDEXES - 5 indexes
    // ============================================================
    products: [
        { name: 'byName', keyPath: 'name' },
        { name: 'bySku', keyPath: 'sku' },
        { name: 'byCategory', keyPath: 'category' },
        { name: 'byActive', keyPath: 'active' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // INVOICES INDEXES - 5 indexes
    // MATCHES invoice-service.js field names
    // ============================================================
    invoices: [
        { name: 'byNumber', keyPath: 'invoiceNumber' },
        { name: 'byDate', keyPath: 'invoiceDate' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byStatus', keyPath: 'paymentStatus' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // QUOTATIONS INDEXES - 5 indexes
    // MATCHES quotation-service.js field names
    // ============================================================
    quotations: [
        { name: 'byNumber', keyPath: 'quotationNumber' },
        { name: 'byDate', keyPath: 'quotationDate' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byStatus', keyPath: 'status' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // PAYMENTS INDEXES - 6 indexes
    // MATCHES payment-service.js field names
    // ============================================================
    payments: [
        { name: 'byNumber', keyPath: 'paymentNumber' },
        { name: 'byDate', keyPath: 'paymentDate' },
        { name: 'byInvoiceId', keyPath: 'invoiceId' },
        { name: 'byCustomerId', keyPath: 'customerId' },
        { name: 'byMethod', keyPath: 'paymentMethod' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // TEMPLATES INDEXES - 3 indexes
    // ============================================================
    templates: [
        { name: 'byType', keyPath: 'type' },
        { name: 'byDefault', keyPath: 'isDefault' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // IMAGES INDEXES - 3 indexes
    // ============================================================
    images: [
        { name: 'byName', keyPath: 'name' },
        { name: 'byType', keyPath: 'type' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ],
    
    // ============================================================
    // FONTS INDEXES - 3 indexes
    // ============================================================
    fonts: [
        { name: 'byFamily', keyPath: 'family' },
        { name: 'byType', keyPath: 'type' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
    ]
};

// TOTAL INDEXES: 35

// ============================================================
// MAIN MIGRATION FUNCTION
// ============================================================

/**
 * Migrate database schema
 * Called from database.js during onupgradeneeded
 * 
 * @param {IDBDatabase} db - Database instance
 * @param {IDBTransaction} transaction - Upgrade transaction
 * @param {number} oldVersion - Current version (from database.js)
 * @param {number} newVersion - New version (from database.js)
 */
export function migrateDatabase(db, transaction, oldVersion, newVersion) {
    console.log(`📋 Migration: ${oldVersion} → ${newVersion}`);
    
    // Run migrations sequentially by version
    if (oldVersion < 1) {
        migrateToV1(db, transaction);
    }
    
    // Future migrations (add as needed):
    // if (oldVersion < 2) {
    //     migrateToV2(db, transaction);
    // }
    // if (oldVersion < 3) {
    //     migrateToV3(db, transaction);
    // }
    
    console.log(`✅ Migration completed: ${oldVersion} → ${newVersion}`);
}

// ============================================================
// MIGRATION FUNCTIONS
// ============================================================

/**
 * Migration to Version 1 - Initial schema
 * Creates all stores, indexes, and seeds default data
 */
function migrateToV1(db, transaction) {
    console.log('📋 Migrating to v1: Initial schema');
    
    // 1. Create all object stores
    createStores(db, transaction);
    
    // 2. Create all indexes
    createIndexes(db, transaction);
    
    // 3. Seed default data (only if empty)
    seedDefaultData(db, transaction);
}

// ============================================================
// STORE CREATION
// ============================================================

/**
 * Create all object stores
 * Uses the upgrade transaction to create stores
 * Does NOT delete or clear existing data
 */
function createStores(db, transaction) {
    for (const [storeName, config] of Object.entries(STORE_DEFINITIONS)) {
        if (!db.objectStoreNames.contains(storeName)) {
            // Create store using the upgrade transaction
            db.createObjectStore(storeName, {
                keyPath: config.keyPath,
                autoIncrement: config.autoIncrement
            });
            console.log(`📁 Created store: ${storeName}`);
        }
    }
}

// ============================================================
// INDEX CREATION
// ============================================================

/**
 * Create all indexes
 * Uses transaction.objectStore() to get the store reference
 * and create indexes during upgrade
 * 
 * IMPORTANT: Checks if index exists before creating
 * to prevent duplicate index errors
 */
function createIndexes(db, transaction) {
    for (const [storeName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
        if (db.objectStoreNames.contains(storeName)) {
            // Get store from the upgrade transaction
            const store = transaction.objectStore(storeName);
            
            for (const idx of indexes) {
                // Safety check: Only create if index doesn't exist
                if (!store.indexNames.contains(idx.name)) {
                    // Create index using the upgrade transaction
                    store.createIndex(idx.name, idx.keyPath, { unique: false });
                    console.log(`📊 Created index: ${storeName}.${idx.name}`);
                } else {
                    console.log(`📊 Index already exists: ${storeName}.${idx.name}`);
                }
            }
        }
    }
}

// ============================================================
// DEFAULT DATA SEEDING
// ============================================================

/**
 * Seed default configuration data
 * ONLY creates data if the store is empty
 * NEVER overwrites existing data
 * 
 * This preserves existing user data during migration
 * 
 * IMPORTANT: Field names must match service expectations
 */
function seedDefaultData(db, transaction) {
    const now = new Date().toISOString();

    // ============================================================
    // COMPANY DEFAULT DATA
    // MATCHES company-service.js data model
    // ============================================================
    if (db.objectStoreNames.contains('company')) {
        const store = transaction.objectStore('company');
        const request = store.get('company');
        request.onsuccess = () => {
            if (!request.result) {
                store.add({
                    id: 'company',
                    companyName: '',
                    brandName: '',
                    address: '',
                    city: '',
                    district: '',
                    state: 'Kerala',
                    pincode: '',
                    phone: '',
                    whatsapp: '',
                    email: '',
                    website: '',
                    gstin: '',
                    pan: '',
                    companyLogoId: null,
                    brandLogoId: null,
                    signatureImageId: null,
                    bankDetails: {
                        enabled: false,
                        bankName: '',
                        accountName: '',
                        accountNumber: '',
                        ifsc: '',
                        branch: ''
                    },
                    upiDetails: {
                        enabled: false,
                        upiId: '',
                        qrImageId: null
                    },
                    authorizedSignatory: {
                        enabled: false,
                        name: '',
                        designation: '',
                        signatureImageId: null
                    },
                    invoiceTerms: '',
                    quotationTerms: '',
                    warrantyTerms: '',
                    paymentTerms: '',
                    invoiceFooter: '',
                    quotationFooter: '',
                    createdAt: now,
                    updatedAt: now
                });
                console.log('🏢 Default company record created');
            } else {
                console.log('🏢 Company record already exists - preserving data');
            }
        };
        request.onerror = () => {
            console.warn('⚠️ Could not check company store during migration');
        };
    }

    // ============================================================
    // SETTINGS DEFAULT DATA
    // ============================================================
    if (db.objectStoreNames.contains('settings')) {
        const store = transaction.objectStore('settings');
        const request = store.get('settings');
        request.onsuccess = () => {
            if (!request.result) {
                store.add({
                    id: 'settings',
                    currency: 'INR',
                    gstEnabled: true,
                    gstRates: [0, 5, 7, 9, 18, 28],
                    documentNumbering: {
                        invoice: {
                            prefix: 'INV-',
                            start: 1,
                            padding: 5,
                            yearlyReset: false,
                            financialYearReset: false
                        },
                        quotation: {
                            prefix: 'QUO-',
                            start: 1,
                            padding: 5,
                            yearlyReset: false,
                            financialYearReset: false
                        },
                        payment: {
                            prefix: 'PAY-',
                            start: 1,
                            padding: 5
                        }
                    },
                    units: [
                        'Nos', 'Bag', 'Kg', 'Gram', 'Litre', 'ML',
                        'Meter', 'Sq.ft', 'Sq.m', 'Box', 'Set',
                        'Piece', 'Hour', 'Day', 'Trip', 'Job'
                    ],
                    rounding: {
                        method: 'nearest',
                        precision: 0
                    },
                    dateFormat: 'DD/MM/YYYY',
                    theme: {
                        mode: 'light',
                        accent: 'purple'
                    },
                    scale: 100,
                    general: {
                        autoSave: true,
                        notifications: true,
                        offline: true
                    },
                    defaultInvoiceTemplate: 'professional',
                    defaultQuotationTemplate: 'quotation-professional',
                    paymentTerms: '30 days',
                    updatedAt: now
                });
                console.log('⚙️ Default settings created');
            } else {
                console.log('⚙️ Settings already exist - preserving data');
            }
        };
        request.onerror = () => {
            console.warn('⚠️ Could not check settings store during migration');
        };
    }

    // ============================================================
    // NUMBERING DEFAULT DATA
    // ============================================================
    if (db.objectStoreNames.contains('numbering')) {
        const store = transaction.objectStore('numbering');
        const request = store.get('numbering');
        request.onsuccess = () => {
            if (!request.result) {
                store.add({
                    id: 'numbering',
                    invoice: { 
                        current: 1, 
                        year: new Date().getFullYear() 
                    },
                    quotation: { 
                        current: 1, 
                        year: new Date().getFullYear() 
                    },
                    payment: { 
                        current: 1, 
                        year: new Date().getFullYear() 
                    },
                    updatedAt: now
                });
                console.log('🔢 Default numbering created');
            } else {
                console.log('🔢 Numbering already exists - preserving data');
            }
        };
        request.onerror = () => {
            console.warn('⚠️ Could not check numbering store during migration');
        };
    }

    // ============================================================
    // TEMPLATES DEFAULT DATA
    // ============================================================
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
                            header: {
                                showLogo: true,
                                showTitle: true,
                                alignment: 'center'
                            },
                            footer: {
                                showTerms: true,
                                showBank: true,
                                showSignature: true
                            },
                            items: {
                                showHsn: true,
                                showGst: true,
                                showDiscount: true
                            },
                            colors: {
                                primary: '#6C3BC5',
                                secondary: '#4A2A8A',
                                accent: '#FFD700'
                            }
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
                            header: {
                                showLogo: true,
                                showTitle: true,
                                alignment: 'left'
                            },
                            footer: {
                                showTerms: true,
                                showBank: true,
                                showSignature: true
                            },
                            items: {
                                showHsn: true,
                                showGst: true,
                                showDiscount: true
                            },
                            colors: {
                                primary: '#1A1A2E',
                                secondary: '#16213E',
                                accent: '#0F3460'
                            }
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
                            header: {
                                showLogo: true,
                                showTitle: true,
                                alignment: 'center'
                            },
                            footer: {
                                showTerms: true,
                                showBank: true,
                                showSignature: true
                            },
                            items: {
                                showHsn: true,
                                showGst: true,
                                showDiscount: true
                            },
                            colors: {
                                primary: '#2C3E50',
                                secondary: '#34495E',
                                accent: '#E74C3C'
                            }
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
                            header: {
                                showLogo: true,
                                showTitle: true,
                                alignment: 'center'
                            },
                            footer: {
                                showTerms: true,
                                showBank: true,
                                showSignature: true
                            },
                            items: {
                                showHsn: true,
                                showGst: true,
                                showDiscount: true
                            },
                            colors: {
                                primary: '#6C3BC5',
                                secondary: '#4A2A8A',
                                accent: '#FFD700'
                            }
                        },
                        createdAt: now,
                        updatedAt: now
                    }
                ];

                for (const template of templates) {
                    store.add(template);
                }
                console.log('📄 Default templates created');
            } else {
                console.log('📄 Templates already exist - preserving data');
            }
        };
        request.onerror = () => {
            console.warn('⚠️ Could not check templates store during migration');
        };
    }
}

// ============================================================
// FUTURE MIGRATION FUNCTIONS (Example)
// ============================================================

/**
 * Example: Migration to Version 2
 * Uncomment and implement when database.js version is increased to 2
 * 
 * IMPORTANT: Never clear existing data during migration
 */
/*
function migrateToV2(db, transaction) {
    console.log('📋 Migrating to v2: Adding email index to customers');
    
    // Add new index to customers
    if (db.objectStoreNames.contains('customers')) {
        const store = transaction.objectStore('customers');
        if (!store.indexNames.contains('byEmail')) {
            store.createIndex('byEmail', 'email', { unique: false });
            console.log('📊 Added index: customers.byEmail');
        }
    }
    
    // Add new index to invoices
    if (db.objectStoreNames.contains('invoices')) {
        const store = transaction.objectStore('invoices');
        if (!store.indexNames.contains('byDueDate')) {
            store.createIndex('byDueDate', 'dueDate', { unique: false });
            console.log('📊 Added index: invoices.byDueDate');
        }
    }
}
*/

/**
 * Example: Migration to Version 3
 * Uncomment and implement when database.js version is increased to 3
 */
/*
function migrateToV3(db, transaction) {
    console.log('📋 Migrating to v3: Adding auditLog store');
    
    // Add new store
    if (!db.objectStoreNames.contains('auditLog')) {
        db.createObjectStore('auditLog', {
            keyPath: 'id',
            autoIncrement: false
        });
        console.log('📁 Created store: auditLog');
    }
}
*/

// ============================================================
// EXPORT CONFIGURATIONS FOR REFERENCE
// ============================================================

export { STORE_DEFINITIONS, INDEX_DEFINITIONS };

// ============================================================
// SUMMARY
// ============================================================
// STORES: 11
// INDEXES: 35
// VERSION: 1 (owned by database.js)
// 
// STORE LIST:
// company, customers, products, invoices, quotations,
// payments, templates, images, fonts, settings, numbering
// 
// GST RATES: 0, 5, 7, 9, 18, 28
// 
// FIELD NAME SYNCHRONIZATION:
// ✓ invoices: invoiceNumber, invoiceDate, paymentStatus
// ✓ quotations: quotationNumber, quotationDate
// ✓ payments: paymentNumber, paymentDate, paymentMethod
// ✓ company: companyName, district, pincode, companyLogoId, etc.
// ✓ numbering: id, invoice, quotation, payment, updatedAt
// 
// RESPONSIBILITY:
// - Schema creation during upgrade
// - Index creation during upgrade (35 indexes)
// - Default data seeding (only if empty)
// - Future migrations
// 
// DOES NOT:
// - Open database
// - Define DB_NAME or DB_VERSION
// - Dispatch events
// - Contain UI or business logic
// - Clear existing data
// - Overwrite existing user data
// - Create duplicate databases
// 
// DATA PROTECTION:
// - Existing data is NEVER cleared during migration
// - Default data is ONLY created if store is empty
// - Indexes are ONLY created if they don't exist
// - No automatic database deletion
// ============================================================