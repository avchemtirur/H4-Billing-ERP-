/**
 * H4 Billing ERP - Events Module
 * Central event bus for cross-module communication
 * Version: 1.0.0
 * 
 * ============================================================
 * PURPOSE
 * ============================================================
 * 
 * events.js enables modules to communicate without direct coupling.
 * When data changes in one module, other modules are notified.
 * 
 * ============================================================
 * EVENT COUNT: 24
 * ============================================================
 * 
 * Database: 1
 * Customer: 3
 * Product: 3
 * Company: 1
 * Invoice: 3
 * Quotation: 3
 * Payment: 3
 * Template: 3
 * Image: 1
 * Font: 1
 * Settings: 1
 * Theme: 1
 * TOTAL: 24
 * 
 * ============================================================
 * WHAT IT DOES
 * ============================================================
 * 
 * - Central event names (EVENTS object) - 24 events
 * - Dispatch events (emit)
 * - Listen for events (on)
 * - Remove listeners (off)
 * - Standard event format
 * - Error handling (listener errors don't break others)
 * - Event history for debugging
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB
 * - Does NOT perform CRUD operations
 * - Does NOT calculate GST/discounts
 * - Does NOT render UI
 * - Does NOT contain business logic
 * - Does NOT create databases
 * 
 * ============================================================
 * DATA FLOW
 * ============================================================
 * 
 * Service (customer-service.js)
 *     ↓
 * emit('h4:customer-added', data)
 *     ↓
 * events.js (dispatches to all listeners)
 *     ↓
 * ┌─────────────┬─────────────┬─────────────┐
 * ↓             ↓             ↓             ↓
 * invoice.html  quotation.html  dashboard   customers.html
 * (refresh list) (refresh list) (update KPI) (update list)
 * 
 * ============================================================
 * WHY IT'S NEEDED
 * ============================================================
 * 
 * Without events.js:
 * - Customer added → invoice.html doesn't know → stale data
 * - Product updated → quotation.html doesn't know → wrong rates
 * - Payment added → dashboard doesn't know → wrong outstanding
 * - Template changed → preview doesn't know → old template
 * 
 * With events.js:
 * - All modules stay synchronized
 * - No polling or manual refresh needed
 * - Clean decoupling between modules
 * ============================================================
 */

// ============================================================
// EVENT NAMES
// ============================================================

/**
 * Central event names - ALL events must use these names
 * 
 * IMPORTANT: Do NOT use different names in different modules.
 * Always use these constants.
 * 
 * TOTAL EVENTS: 24
 */
export const EVENTS = {
    // ============================================================
    // DATABASE EVENTS - 1
    // ============================================================
    DATABASE_READY: 'h4:database-ready',

    // ============================================================
    // CUSTOMER EVENTS - 3
    // ============================================================
    CUSTOMER_ADDED: 'h4:customer-added',
    CUSTOMER_UPDATED: 'h4:customer-updated',
    CUSTOMER_DELETED: 'h4:customer-deleted',

    // ============================================================
    // PRODUCT EVENTS - 3
    // ============================================================
    PRODUCT_ADDED: 'h4:product-added',
    PRODUCT_UPDATED: 'h4:product-updated',
    PRODUCT_DELETED: 'h4:product-deleted',

    // ============================================================
    // COMPANY EVENTS - 1
    // ============================================================
    COMPANY_UPDATED: 'h4:company-updated',

    // ============================================================
    // INVOICE EVENTS - 3
    // ============================================================
    INVOICE_CREATED: 'h4:invoice-created',
    INVOICE_UPDATED: 'h4:invoice-updated',
    INVOICE_DELETED: 'h4:invoice-deleted',

    // ============================================================
    // QUOTATION EVENTS - 3
    // ============================================================
    QUOTATION_CREATED: 'h4:quotation-created',
    QUOTATION_UPDATED: 'h4:quotation-updated',
    QUOTATION_DELETED: 'h4:quotation-deleted',

    // ============================================================
    // PAYMENT EVENTS - 3
    // ============================================================
    PAYMENT_ADDED: 'h4:payment-added',
    PAYMENT_UPDATED: 'h4:payment-updated',
    PAYMENT_DELETED: 'h4:payment-deleted',

    // ============================================================
    // TEMPLATE EVENTS - 3
    // ============================================================
    TEMPLATE_ADDED: 'h4:template-added',
    TEMPLATE_UPDATED: 'h4:template-updated',
    TEMPLATE_DELETED: 'h4:template-deleted',

    // ============================================================
    // IMAGE EVENTS - 1
    // ============================================================
    IMAGE_UPDATED: 'h4:image-updated',

    // ============================================================
    // FONT EVENTS - 1
    // ============================================================
    FONT_UPDATED: 'h4:font-updated',

    // ============================================================
    // SETTINGS EVENTS - 1
    // ============================================================
    SETTINGS_UPDATED: 'h4:settings-updated',

    // ============================================================
    // THEME EVENTS - 1
    // ============================================================
    THEME_UPDATED: 'h4:theme-updated'
};

// ============================================================
// EVENT COUNT VALIDATION
// ============================================================

// Total: 1 + 3 + 3 + 1 + 3 + 3 + 3 + 3 + 1 + 1 + 1 + 1 = 24
const EVENT_COUNT = Object.keys(EVENTS).length;
console.log(`📡 Events loaded: ${EVENT_COUNT} events`);

// ============================================================
// EVENT BUS CLASS
// ============================================================

class EventBus {
    constructor() {
        this._listeners = new Map();
        this._listenerIdCounter = 0;
        this._history = [];
        this._maxHistory = 100;
        this._debug = false;
        this._activeListeners = new Set();
    }

    /**
     * Enable or disable debug mode
     * @param {boolean} enabled
     */
    setDebug(enabled) {
        this._debug = enabled;
        console.log(`🐛 Event debug mode: ${enabled ? 'ON' : 'OFF'}`);
    }

    /**
     * Set maximum history size
     * @param {number} max
     */
    setMaxHistory(max) {
        this._maxHistory = max;
    }

    // ============================================================
    // EVENT DISPATCH (emit)
    // ============================================================

    /**
     * Dispatch an event to all listeners
     * @param {string} eventName - Event name (use EVENTS constants)
     * @param {Object} data - Event data
     * @param {string} source - Source module/service name
     * @returns {Promise<Array>} - Results from all listeners
     */
    async emit(eventName, data = null, source = 'unknown') {
        if (!eventName || typeof eventName !== 'string') {
            console.warn('⚠️ emit: Invalid event name', eventName);
            return [];
        }

        // Get listeners for this event
        const listeners = this._listeners.get(eventName);
        if (!listeners || listeners.length === 0) {
            if (this._debug) {
                console.log(`📡 Event emitted (no listeners): ${eventName}`);
            }
            return [];
        }

        // Create standard event payload
        const payload = this._createPayload(eventName, data, source);

        // Add to history
        this._addToHistory(payload);

        if (this._debug) {
            console.log(`📡 Event emitted: ${eventName}`, payload);
        }

        // Execute all listeners
        const results = [];
        const toRemove = [];

        for (const listener of listeners) {
            try {
                // Check if listener should be removed (once)
                if (listener.once) {
                    toRemove.push(listener.id);
                }

                // Execute listener
                const result = listener.callback(payload, eventName);

                // Handle async results
                if (result instanceof Promise) {
                    const asyncResult = await result;
                    results.push(asyncResult);
                } else {
                    results.push(result);
                }

            } catch (error) {
                console.error(`❌ Error in event listener for ${eventName}:`, error);
                results.push({ error: error.message, stack: error.stack });
            }
        }

        // Remove once listeners
        for (const id of toRemove) {
            this._removeListener(eventName, id);
        }

        return results;
    }

    /**
     * Dispatch an event synchronously (no promises)
     * @param {string} eventName - Event name (use EVENTS constants)
     * @param {Object} data - Event data
     * @param {string} source - Source module/service name
     * @returns {Array} - Results from all listeners
     */
    emitSync(eventName, data = null, source = 'unknown') {
        if (!eventName || typeof eventName !== 'string') {
            console.warn('⚠️ emitSync: Invalid event name', eventName);
            return [];
        }

        const listeners = this._listeners.get(eventName);
        if (!listeners || listeners.length === 0) {
            if (this._debug) {
                console.log(`📡 Event emitted (sync, no listeners): ${eventName}`);
            }
            return [];
        }

        const payload = this._createPayload(eventName, data, source);
        this._addToHistory(payload);

        if (this._debug) {
            console.log(`📡 Event emitted (sync): ${eventName}`, payload);
        }

        const results = [];
        const toRemove = [];

        for (const listener of listeners) {
            try {
                if (listener.once) {
                    toRemove.push(listener.id);
                }
                const result = listener.callback(payload, eventName);
                results.push(result);
            } catch (error) {
                console.error(`❌ Error in event listener for ${eventName}:`, error);
                results.push({ error: error.message });
            }
        }

        for (const id of toRemove) {
            this._removeListener(eventName, id);
        }

        return results;
    }

    // ============================================================
    // EVENT LISTENING (on / once)
    // ============================================================

    /**
     * Register a listener for an event
     * @param {string} eventName - Event name (use EVENTS constants)
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} options - { once: boolean, priority: number }
     * @returns {Function} - Unsubscribe function
     */
    on(eventName, callback, options = {}) {
        if (!eventName || typeof eventName !== 'string') {
            throw new Error('Invalid event name');
        }
        if (typeof callback !== 'function') {
            throw new Error('Event callback must be a function');
        }

        const id = ++this._listenerIdCounter;
        const priority = options.priority || 0;
        const once = options.once || false;
        const listener = { id, callback, priority, once };

        // Store listener
        if (!this._listeners.has(eventName)) {
            this._listeners.set(eventName, []);
        }

        const listeners = this._listeners.get(eventName);

        // Insert by priority (higher priority first)
        let inserted = false;
        for (let i = 0; i < listeners.length; i++) {
            if (listeners[i].priority < priority) {
                listeners.splice(i, 0, listener);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            listeners.push(listener);
        }

        this._activeListeners.add(id);

        if (this._debug) {
            console.log(`📡 Listener added: ${eventName} (id: ${id}, priority: ${priority})`);
        }

        // Return unsubscribe function
        return () => {
            this.off(eventName, id);
        };
    }

    /**
     * Register a one-time listener for an event
     * @param {string} eventName - Event name (use EVENTS constants)
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} options - { priority: number }
     * @returns {Function} - Unsubscribe function
     */
    once(eventName, callback, options = {}) {
        return this.on(eventName, callback, { ...options, once: true });
    }

    /**
     * Remove a listener
     * @param {string} eventName - Event name
     * @param {number|Function} identifier - Listener ID or callback function
     */
    off(eventName, identifier) {
        if (!this._listeners.has(eventName)) {
            return;
        }

        const listeners = this._listeners.get(eventName);

        if (typeof identifier === 'function') {
            // Remove by callback function
            const index = listeners.findIndex(l => l.callback === identifier);
            if (index !== -1) {
                const removed = listeners.splice(index, 1)[0];
                this._activeListeners.delete(removed.id);
                if (this._debug) {
                    console.log(`📡 Listener removed: ${eventName} (by callback)`);
                }
            }
        } else {
            // Remove by ID
            this._removeListener(eventName, identifier);
        }

        // Clean up empty event
        if (listeners.length === 0) {
            this._listeners.delete(eventName);
        }
    }

    /**
     * Remove all listeners for an event or all events
     * @param {string} eventName - Optional event name
     */
    offAll(eventName = null) {
        if (eventName) {
            const listeners = this._listeners.get(eventName);
            if (listeners) {
                for (const listener of listeners) {
                    this._activeListeners.delete(listener.id);
                }
                this._listeners.delete(eventName);
                if (this._debug) {
                    console.log(`📡 All listeners removed: ${eventName}`);
                }
            }
        } else {
            this._listeners.clear();
            this._activeListeners.clear();
            if (this._debug) {
                console.log('📡 All listeners removed');
            }
        }
    }

    // ============================================================
    // INTERNAL METHODS
    // ============================================================

    /**
     * Create standard event payload
     */
    _createPayload(eventName, data, source) {
        return {
            type: eventName,
            timestamp: Date.now(),
            isoTimestamp: new Date().toISOString(),
            source: source || 'unknown',
            action: this._extractAction(eventName),
            id: data && data.id ? data.id : null,
            payload: data || null
        };
    }

    /**
     * Extract action from event name
     */
    _extractAction(eventName) {
        const parts = eventName.split(':');
        if (parts.length > 1) {
            return parts[1] || 'unknown';
        }
        return 'unknown';
    }

    /**
     * Add event to history
     */
    _addToHistory(payload) {
        this._history.push(payload);
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
    }

    /**
     * Remove a listener by ID
     */
    _removeListener(eventName, id) {
        const listeners = this._listeners.get(eventName);
        if (!listeners) {
            return;
        }

        const index = listeners.findIndex(l => l.id === id);
        if (index !== -1) {
            const removed = listeners.splice(index, 1)[0];
            this._activeListeners.delete(removed.id);
            if (this._debug) {
                console.log(`📡 Listener removed: ${eventName} (id: ${id})`);
            }
        }
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    /**
     * Check if an event has listeners
     * @param {string} eventName - Event name
     * @returns {boolean}
     */
    hasListeners(eventName) {
        return this._listeners.has(eventName) &&
               this._listeners.get(eventName).length > 0;
    }

    /**
     * Get listener count for an event
     * @param {string} eventName - Event name
     * @returns {number}
     */
    listenerCount(eventName) {
        if (!this._listeners.has(eventName)) {
            return 0;
        }
        return this._listeners.get(eventName).length;
    }

    /**
     * Get all event names with listeners
     * @returns {Array<string>}
     */
    getActiveEvents() {
        return Array.from(this._listeners.keys());
    }

    /**
     * Get total listener count across all events
     * @returns {number}
     */
    totalListenerCount() {
        let count = 0;
        for (const listeners of this._listeners.values()) {
            count += listeners.length;
        }
        return count;
    }

    /**
     * Get event history
     * @param {number} limit - Number of events to return
     * @param {string} eventName - Optional filter by event name
     * @returns {Array}
     */
    getHistory(limit = 20, eventName = null) {
        let history = this._history;
        if (eventName) {
            history = history.filter(h => h.type === eventName);
        }
        return history.slice(-limit);
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this._history = [];
        if (this._debug) {
            console.log('📡 Event history cleared');
        }
    }

    /**
     * Get event bus statistics
     * @returns {Object}
     */
    getStats() {
        const events = [];
        for (const [event, listeners] of this._listeners) {
            events.push({
                event,
                count: listeners.length,
                once: listeners.filter(l => l.once).length
            });
        }

        return {
            totalEvents: this._listeners.size,
            totalListeners: this.totalListenerCount(),
            activeListenerIds: this._activeListeners.size,
            historySize: this._history.length,
            events: events,
            debug: this._debug,
            totalEventTypes: Object.keys(EVENTS).length
        };
    }

    /**
     * Reset event bus (remove all listeners and history)
     */
    reset() {
        this._listeners.clear();
        this._activeListeners.clear();
        this._history = [];
        if (this._debug) {
            console.log('📡 Event bus reset');
        }
    }

    /**
     * Create a scoped event bus for a specific module
     * @param {string} scope - Scope name
     * @returns {Object} - Scoped event bus
     */
    scope(scope) {
        return {
            emit: (event, data) => this.emit(event, data, scope),
            emitSync: (event, data) => this.emitSync(event, data, scope),
            on: (event, callback, options) => this.on(event, callback, options),
            once: (event, callback, options) => this.once(event, callback, options),
            off: (event, identifier) => this.off(event, identifier),
            hasListeners: (event) => this.hasListeners(event),
            listenerCount: (event) => this.listenerCount(event)
        };
    }

    /**
     * Wait for an event to be emitted
     * @param {string} eventName - Event name
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<Object>} - Event payload
     */
    waitFor(eventName, timeout = 30000) {
        return new Promise((resolve, reject) => {
            let timeoutId = null;

            const listener = (payload) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                this.off(eventName, listener);
                resolve(payload);
            };

            this.once(eventName, listener);

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    this.off(eventName, listener);
                    reject(new Error(`Timeout waiting for event: ${eventName}`));
                }, timeout);
            }
        });
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const eventBus = new EventBus();

// ============================================================
// LISTEN FOR DATABASE READY FROM DATABASE.JS
// ============================================================

// Forward database ready event from DOM to event bus
window.addEventListener('h4:database-ready', (event) => {
    const detail = event.detail || {};
    eventBus.emit(EVENTS.DATABASE_READY, detail, 'database');
});

// ============================================================
// EXPORT
// ============================================================

export { eventBus, EVENTS };
export default eventBus;

// ============================================================
// USAGE EXAMPLES
// ============================================================

/*
// ============================================================
// IMPORTING
// ============================================================

import eventBus, { EVENTS } from './events.js';


// ============================================================
// DISPATCH EVENTS (from services)
// ============================================================

// After customer is added
async function addCustomer(customerData) {
    const id = await database.add('customers', customerData);
    
    // Dispatch event
    await eventBus.emit(EVENTS.CUSTOMER_ADDED, {
        id: id,
        name: customerData.name,
        data: customerData
    }, 'customer-service');
    
    return id;
}

// After product is updated
async function updateProduct(id, productData) {
    await database.put('products', { id, ...productData });
    
    eventBus.emitSync(EVENTS.PRODUCT_UPDATED, {
        id: id,
        data: productData
    }, 'product-service');
}

// After payment is added
async function addPayment(paymentData) {
    const id = await database.add('payments', paymentData);
    
    eventBus.emit(EVENTS.PAYMENT_ADDED, {
        id: id,
        invoiceId: paymentData.invoiceId,
        amount: paymentData.amount,
        data: paymentData
    }, 'payment-service');
}


// ============================================================
// LISTEN FOR EVENTS (from modules)
// ============================================================

// Invoice module listening for customer updates
const unsubscribeCustomer = eventBus.on(EVENTS.CUSTOMER_ADDED, (payload) => {
    console.log('New customer added:', payload.payload.name);
    refreshCustomerDropdown();
});

// Dashboard listening for invoice changes
eventBus.on(EVENTS.INVOICE_CREATED, (payload) => {
    console.log('Invoice created:', payload.payload.id);
    updateDashboardStats();
});

// Quotation listening for product changes
eventBus.on(EVENTS.PRODUCT_UPDATED, (payload) => {
    console.log('Product updated:', payload.payload.id);
    refreshProductSelector();
});

// Invoice listening for payment changes
eventBus.on(EVENTS.PAYMENT_ADDED, (payload) => {
    console.log('Payment added:', payload.payload.amount);
    updateInvoicePaymentStatus(payload.payload.invoiceId);
});


// ============================================================
// LISTEN ONCE
// ============================================================

eventBus.once(EVENTS.DATABASE_READY, (payload) => {
    console.log('Database is ready! Loading data...');
    loadInitialData();
});


// ============================================================
// UNSUBSCRIBE
// ============================================================

unsubscribeCustomer();
eventBus.offAll(EVENTS.CUSTOMER_ADDED);
eventBus.offAll();


// ============================================================
// WAIT FOR EVENT
// ============================================================

try {
    const payload = await eventBus.waitFor(EVENTS.DATABASE_READY, 5000);
    console.log('Database ready within 5 seconds');
} catch (error) {
    console.error('Database not ready within timeout');
}


// ============================================================
// SCOPED EVENT BUS
// ============================================================

const invoiceBus = eventBus.scope('invoice');

// These will have source: 'invoice'
invoiceBus.emit(EVENTS.INVOICE_CREATED, { id: 'INV-001' });
invoiceBus.on(EVENTS.CUSTOMER_UPDATED, (payload) => {
    console.log('Customer updated from invoice scope');
});


// ============================================================
// DEBUGGING
// ============================================================

eventBus.setDebug(true);

const stats = eventBus.getStats();
console.log('Event bus stats:', stats);
console.log('Total event types:', stats.totalEventTypes); // Should be 24

const history = eventBus.getHistory(10);
console.log('Recent events:', history);
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// TOTAL EVENTS: 24
// 
// Database: 1
// Customer: 3
// Product: 3
// Company: 1
// Invoice: 3
// Quotation: 3
// Payment: 3
// Template: 3
// Image: 1
// Font: 1
// Settings: 1
// Theme: 1
// 
// WHAT IT DOES:
// - Central event names (EVENTS object) - 24 events
// - Dispatch events (emit / emitSync)
// - Listen for events (on / once)
// - Remove listeners (off / offAll)
// - Standard event format
// - Error handling
// - Event history for debugging
// 
// WHAT IT DOES NOT DO:
// - Does NOT open IndexedDB
// - Does NOT perform CRUD operations
// - Does NOT calculate GST/discounts
// - Does NOT render UI
// - Does NOT contain business logic
// ============================================================