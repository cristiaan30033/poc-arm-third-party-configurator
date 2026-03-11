// ============================================================================
// c/utils - Configurator Node Builder
//
// Provides a simplified, scalable API for building addedNodes, deletedNodes,
// and updatedNodes payloads for the Salesforce Revenue Cloud CPQ Configurator.
//
// Designed for CLASSIFICATION-type option groups.
//
// Usage:
//   import { ClassificationNodeBuilder } from 'c/utils';
//
//   const added   = ClassificationNodeBuilder.addedNodes(selectedProducts, pricebookEntries, groupClassification, this._configuratorContext);
//   const deleted = ClassificationNodeBuilder.deletedNodes(itemsToDelete); // ClassificationNodeBuilder.deletedNodes([{ key: 'xxx', path: [txId, itemId] }]);
//   const updated = ClassificationNodeBuilder.updatedNodes(itemUpdates); // ClassificationNodeBuilder.updatedNodes([{ key: 'xxx', path: [txId, itemId], fields: { Quantity: 3 } }]);
// ============================================================================


// ============================================================================
// CONSTANTS
// ============================================================================

const SYNTHETIC_ID_PREFIX = 'ref_';
const DEFAULT_CURRENCY     = 'USD';
const DEFAULT_QUANTITY     = 1;
const DEFAULT_UNIT_PRICE   = 0;

/**
 * Supported businessObjectType pairs.
 * Derived automatically from configuratorContext.origin ("Quote" or "Order").
 */
export const BUSINESS_OBJECT_TYPES = Object.freeze({
    QUOTE: {
        lineItem:     'QuoteLineItem',
        relationship: 'QuoteLineRelationship'
    },
    ORDER: {
        lineItem:     'OrderItem',
        relationship: 'OrderItemRelationship'
    }
});

const ASSOCIATED_ITEM_PRICING   = 'IncludedInBundlePrice';
const CONTEXT_RESPONSE_TYPE     = 'Delta';


// ============================================================================
// UTILITY: Synthetic ID generation
// Mirrors the implementation in ficoRCAutils.js, kept local to avoid coupling.
// ============================================================================

/**
 * Generates a UUID-v4-like string used as a temporary reference ID for items
 * that do not yet have a Salesforce record ID.
 *
 * @returns {String} UUID-v4 string with underscores as separators
 */
export function generateSyntheticId() {
    const hex    = '0123456789abcdef';
    const random = new Uint32Array(32);
    crypto.getRandomValues(random);

    let result = '';
    for (let i = 0; i < 32; i++) {
        if ([8, 12, 16, 20].includes(i)) result += '_';
        if      (i === 12) result += '4';
        else if (i === 16) result += hex[(random[i] & 0x3) | 0x8];
        else               result += hex[random[i] & 0xf];
    }
    return result;
}

/**
 * Returns a full synthetic reference ID with the standard prefix.
 *
 * @returns {String} e.g. "ref_66fd7c8a_b77b_42d2_a7ae_0df0dcf94d1c"
 */
function newRef() {
    return SYNTHETIC_ID_PREFIX + generateSyntheticId();
}


// ============================================================================
// BUILDER: LineItem Node (Single Responsibility)
//
// Builds one node of type QuoteLineItem or OrderItem.
// Consumers call build() after chaining all required setters.
// ============================================================================

class LineItemNodeBuilder {

    constructor() {
        this._reset();
    }

    _reset() {
        this._data = {
            refId:              null,
            transactionId:      null,
            pricebookEntryId:   null,
            sellingModelId:     null,
            sellingModelType:   null,
            unitPrice:          DEFAULT_UNIT_PRICE,
            quantity:           DEFAULT_QUANTITY,
            productId:          null,
            productCode:        null,
            productName:        null,
            productBasedOnId:   null,
            currencyIsoCode:    DEFAULT_CURRENCY,
            businessObjectType: BUSINESS_OBJECT_TYPES.QUOTE.lineItem
        };
    }

    withRefId(refId)                     { this._data.refId              = refId;              return this; }
    withTransactionId(id)                { this._data.transactionId      = id;                 return this; }
    withPricebookEntry(id)               { this._data.pricebookEntryId   = id;                 return this; }
    withSellingModel(id)                 { this._data.sellingModelId     = id;                 return this; }
    withSellingModelType(type)           { this._data.sellingModelType   = type;               return this; }
    withUnitPrice(price)                 { this._data.unitPrice          = price ?? 0;         return this; }
    withQuantity(qty)                    { this._data.quantity           = qty  ?? 1;          return this; }
    withProduct(id)                      { this._data.productId          = id;                 return this; }
    withProductCode(code)                { this._data.productCode        = code;               return this; }
    withProductName(name)                { this._data.productName        = name;               return this; }
    withProductBasedOn(basedOnId)        { this._data.productBasedOnId   = basedOnId;          return this; }
    withCurrencyIsoCode(code)            { this._data.currencyIsoCode    = code;               return this; }
    withBusinessObjectType(type)         { this._data.businessObjectType = type;               return this; }

    build() {
        const d = this._data;

        if (!d.refId)         throw new Error('LineItemNodeBuilder: refId is required');
        if (!d.transactionId) throw new Error('LineItemNodeBuilder: transactionId is required');
        if (!d.productId)     throw new Error('LineItemNodeBuilder: productId is required');

        const node = {
            path: [d.transactionId, d.refId],
            addedObject: {
                id:                          d.refId,
                SalesTransactionItemSource:  d.refId,
                SalesTransactionItemParent:  d.transactionId,
                PricebookEntry:              d.pricebookEntryId,
                ProductSellingModel:         d.sellingModelId,
                SellingModelType:            d.sellingModelType,
                UnitPrice:                   d.unitPrice,
                Quantity:                    d.quantity,
                Product:                     d.productId,
                ProductCode:                 d.productCode,
                ProductName:                 d.productName,
                ProductBasedOn:              d.productBasedOnId,
                SalesTrxnItemRelationship:   [],
                businessObjectType:          d.businessObjectType,
                CurrencyIsoCode:             d.currencyIsoCode
            }
        };

        this._reset();
        return node;
    }
}


// ============================================================================
// BUILDER: Relationship Node (Single Responsibility)
//
// Builds one node of type QuoteLineRelationship or OrderItemRelationship.
// Requires the refId of the already-built LineItem node.
// ============================================================================

class RelationshipNodeBuilder {

    constructor() {
        this._reset();
    }

    _reset() {
        this._data = {
            refId:                   null,
            transactionId:           null,
            lineItemRefId:           null,
            mainItemId:              null,
            productRelatedCompId:    null,
            quantityScaleMethod:     'Proportional',
            businessObjectType:      BUSINESS_OBJECT_TYPES.QUOTE.relationship
        };
    }

    withRefId(refId)                     { this._data.refId                = refId;   return this; }
    withTransactionId(id)                { this._data.transactionId        = id;      return this; }
    withLineItemRefId(id)                { this._data.lineItemRefId        = id;      return this; }
    withMainItem(id)                     { this._data.mainItemId           = id;      return this; }
    withProductRelatedComponent(id)      { this._data.productRelatedCompId = id;      return this; }
    withQuantityScaleMethod(method)      { this._data.quantityScaleMethod  = method;  return this; }
    withBusinessObjectType(type)         { this._data.businessObjectType   = type;    return this; }

    build() {
        const d = this._data;

        if (!d.refId)                throw new Error('RelationshipNodeBuilder: refId is required');
        if (!d.transactionId)        throw new Error('RelationshipNodeBuilder: transactionId is required');
        if (!d.lineItemRefId)        throw new Error('RelationshipNodeBuilder: lineItemRefId is required');
        if (!d.mainItemId)           throw new Error('RelationshipNodeBuilder: mainItemId is required');
        if (!d.productRelatedCompId) throw new Error('RelationshipNodeBuilder: productRelatedComponentId is required');

        const node = {
            path: [d.transactionId, d.lineItemRefId, d.refId],
            addedObject: {
                id:                        d.refId,
                MainItem:                  d.mainItemId,
                AssociatedItem:            d.lineItemRefId,
                ProductRelatedComponent:   d.productRelatedCompId,
                ProductRelationshipType:   null,
                AssociatedItemPricing:     ASSOCIATED_ITEM_PRICING,
                AssociatedQuantScaleMethod: d.quantityScaleMethod,
                businessObjectType:        d.businessObjectType
            }
        };

        this._reset();
        return node;
    }
}


// ============================================================================
// BUILDER: Deleted Node (Single Responsibility)
//
// Builds one entry in the deletedNodes array.
// Reference: connect_requests_configurator_deleted_node_input
// ============================================================================

class DeletedNodeBuilder {

    constructor() {
        this._reset();
    }

    _reset() {
        this._data = {
            key:  null,
            path: []
        };
    }

    /**
     * The record ID or synthetic ref ID of the item to delete.
     *
     * @param {String} key
     */
    withKey(key) {
        if (!key) throw new Error('DeletedNodeBuilder: key is required');
        this._data.key = key;
        return this;
    }

    /**
     * Path from the transaction root down to the item being deleted.
     *
     * @param {String[]} path
     */
    withPath(path) {
        if (!Array.isArray(path) || path.length === 0) {
            throw new Error('DeletedNodeBuilder: path must be a non-empty array');
        }
        this._data.path = path;
        return this;
    }

    build() {
        const d = this._data;
        if (!d.key)            throw new Error('DeletedNodeBuilder: key is required');
        if (!d.path.length)    throw new Error('DeletedNodeBuilder: path is required');

        const node = { key: d.key, path: [...d.path] };
        this._reset();
        return node;
    }
}


// ============================================================================
// BUILDER: Updated Node (Single Responsibility)
//
// Builds one entry in the updatedNodes array.
// Reference: connect_requests_configurator_updated_node_input
// ============================================================================

class UpdatedNodeBuilder {

    constructor() {
        this._reset();
    }

    _reset() {
        this._data = {
            key:           null,
            path:          [],
            updatedObject: {}
        };
    }

    /**
     * The record ID or synthetic ref ID of the item to update.
     *
     * @param {String} key
     */
    withKey(key) {
        if (!key) throw new Error('UpdatedNodeBuilder: key is required');
        this._data.key = key;
        return this;
    }

    /**
     * Path from the transaction root down to the item being updated.
     *
     * @param {String[]} path
     */
    withPath(path) {
        if (!Array.isArray(path) || path.length === 0) {
            throw new Error('UpdatedNodeBuilder: path must be a non-empty array');
        }
        this._data.path = path;
        return this;
    }

    /**
     * Merges one or more fields into the updatedObject.
     * Can be called multiple times to compose the update incrementally.
     *
     * @param {Object} fields - Plain object of field/value pairs to update
     */
    withFields(fields) {
        if (!fields || typeof fields !== 'object') {
            throw new Error('UpdatedNodeBuilder: fields must be a plain object');
        }
        Object.assign(this._data.updatedObject, fields);
        return this;
    }

    build() {
        const d = this._data;
        if (!d.key)         throw new Error('UpdatedNodeBuilder: key is required');
        if (!d.path.length) throw new Error('UpdatedNodeBuilder: path is required');

        const node = {
            key:           d.key,
            path:          [...d.path],
            updatedObject: { ...d.updatedObject }
        };
        this._reset();
        return node;
    }
}


// ============================================================================
// HELPER: Pricebook Entry Resolver (Single Responsibility)
//
// Encapsulates the lookup from _pricebookEntries to a specific product.
// Keeps the main factory free of lookup logic.
// ============================================================================

class PricebookEntryResolver {

    /**
     * @param {Object[]} pricebookEntries - Array from the GraphQL wire result.
     *   Expected shape: { id, product2Id, sellingModelId, sellingModelType, unitPrice }
     */
    constructor(pricebookEntries) {
        // Index by product2Id for O(1) lookups.
        this._index = new Map(
            (pricebookEntries ?? []).map(entry => [entry.product2Id, entry])
        );
    }

    /**
     * Returns the pricebook entry for a given product ID, or null if not found.
     *
     * @param {String} productId
     * @returns {Object|null}
     */
    forProduct(productId) {
        return this._index.get(productId) ?? null;
    }
}


// ============================================================================
// RESOLVER: Business Object Types (Open/Closed)
//
// Resolves the correct lineItem/relationship type pair from context.
// Extend BUSINESS_OBJECT_TYPES to add new transaction types without
// modifying this resolver.
// ============================================================================

/**
 * Resolves the correct lineItem/relationship type pair from configuratorContext.origin.
 * Extend BUSINESS_OBJECT_TYPES to support new transaction types without modifying this function.
 *
 * @param {Object} configuratorContext - this._configuratorContext from the parent component
 * @returns {{ lineItem: String, relationship: String }}
 */
function resolveBusinessObjectTypesFromContext(configuratorContext) {
    const origin = (configuratorContext?.origin ?? '').toLowerCase();
    if (origin === 'quote') return BUSINESS_OBJECT_TYPES.QUOTE;
    if (origin === 'order') return BUSINESS_OBJECT_TYPES.ORDER;
    throw new Error(
        `ClassificationNodeBuilder: unknown origin "${configuratorContext?.origin}". ` +
        'Expected "Quote" or "Order".'
    );
}


// ============================================================================
// FACADE: ClassificationNodeBuilder
//
// The single public API consumed by customProdConfigOptionGroup.js.
// Each static method returns a plain array ready to be placed into the
// configuratorInput payload.
// ============================================================================

export class ClassificationNodeBuilder {

    /**
     * Builds the addedNodes array for a set of products selected from a
     * CLASSIFICATION-type option group.
     *
     * For each selected product two nodes are produced:
     *   1. LineItem node  (QuoteLineItem / OrderItem)
     *   2. Relationship node (QuoteLineRelationship / OrderItemRelationship)
     *
     * @param {Object[]} selectedProducts
     *   Products chosen in the modal.
     *   Shape: { id, name, code, baseOnId, quantity? }
     *
     * @param {Object[]} pricebookEntries
     *   From this._pricebookEntries in the parent component.
     *   Shape: { id, product2Id, sellingModelId, sellingModelType, unitPrice }
     *
     * @param {Object} groupClassification
     *   The raw OptionGroup from this._optionGroups (type CLASSIFICATION).
     *   Uses: components[0].productRelatedComponent.{ id, quantityScaleMethod }
     *
     * @param {Object} configuratorContext
     *   this._configuratorContext from customProdConfigOptionGroup.
     *   Uses: transactionId, transactionLineId, origin, currencyIsoCode
     *
     * @returns {Object[]} addedNodes array
     */
    static addedNodes(selectedProducts, pricebookEntries, prcId, prcQuantityScaleMethod, configuratorContext) {
        _assertConfiguratorContext(configuratorContext);

        const objectTypes  = resolveBusinessObjectTypesFromContext(configuratorContext);
        const pbeResolver  = new PricebookEntryResolver(pricebookEntries);
        //const prc          = _extractProductRelatedComponent(groupClassification);
        const transactionId = configuratorContext.transactionId;
        const mainItemId    = configuratorContext.transactionLineId;
        const currency      = configuratorContext.currencyIsoCode ?? DEFAULT_CURRENCY;
        const nodes         = [];

        for (const product of (selectedProducts ?? [])) {
            const pbe          = pbeResolver.forProduct(product.id);
            const lineItemRef  = newRef();
            const relRef       = newRef();

            if (!pbe) {
                console.warn(
                    `[ClassificationNodeBuilder] No PricebookEntry found for product "${product.name}" (${product.id}). ` +
                    'LineItem will be created with null price data.'
                );
            }

            // Node 1: LineItem
            const lineItem = new LineItemNodeBuilder()
                .withRefId(lineItemRef)
                .withTransactionId(transactionId)
                .withPricebookEntry(pbe?.id ?? null)
                .withSellingModel(pbe?.sellingModelId ?? null)
                .withSellingModelType(pbe?.sellingModelType ?? null)
                .withUnitPrice(pbe?.unitPrice ?? DEFAULT_UNIT_PRICE)
                .withQuantity(product.quantity ?? DEFAULT_QUANTITY)
                .withProduct(product.id)
                .withProductCode(product.code)
                .withProductName(product.name)
                .withProductBasedOn(product.baseOnId ?? product.basedOnId ?? null)
                .withCurrencyIsoCode(currency)
                .withBusinessObjectType(objectTypes.lineItem)
                .build();

            // Node 2: Relationship
            const relationship = new RelationshipNodeBuilder()
                .withRefId(relRef)
                .withTransactionId(transactionId)
                .withLineItemRefId(lineItemRef)
                .withMainItem(mainItemId)
                .withProductRelatedComponent(prcId)
                .withQuantityScaleMethod(prcQuantityScaleMethod)
                .withBusinessObjectType(objectTypes.relationship)
                .build();

            nodes.push(lineItem, relationship);
        }

        return nodes;
    }

    /**
     * Builds the deletedNodes array for one or more items to be removed.
     *
     * @param {Object[]} itemsToDelete
     *   Shape: { key: String, path: String[] }
     *   key  - The record ID or synthetic ref of the item.
     *   path - Full path from transactionId down to the item.
     *          e.g. [transactionId, lineItemId] for a line item,
     *               [transactionId, lineItemId, relId] for a relationship.
     *
     * @returns {Object[]} deletedNodes array
     */
    static deletedNodes(itemsToDelete) {
        return (itemsToDelete ?? []).map(item =>
            new DeletedNodeBuilder()
                .withKey(item.key)
                .withPath(item.path)
                .build()
        );
    }

    /**
     * Builds the updatedNodes array for one or more items to be modified.
     *
     * @param {Object[]} itemUpdates
     *   Shape: { key: String, path: String[], fields: Object }
     *   key    - The record ID of the item to update.
     *   path   - Full path from transactionId down to the item.
     *   fields - Plain object with the fields and new values to apply.
     *            e.g. { Quantity: 3 } or { UnitPrice: 500, ProductSellingModel: 'xxx' }
     *
     * @returns {Object[]} updatedNodes array
     */
    static updatedNodes(itemUpdates) {
        return (itemUpdates ?? []).map(item =>
            new UpdatedNodeBuilder()
                .withKey(item.key)
                .withPath(item.path)
                .withFields(item.fields)
                .build()
        );
    }
}


// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Asserts that the configuratorContext has the required fields for node building.
 *
 * @param {Object} configuratorContext
 */
function _assertConfiguratorContext(configuratorContext) {
    if (!configuratorContext || typeof configuratorContext !== 'object') {
        throw new Error('ClassificationNodeBuilder: configuratorContext is required');
    }
    const required = ['transactionId', 'transactionLineId', 'origin'];
    for (const key of required) {
        if (!configuratorContext[key]) {
            throw new Error(`ClassificationNodeBuilder: configuratorContext.${key} is required`);
        }
    }
}

/**
 * Extracts the ProductRelatedComponent data from the first component
 * of a CLASSIFICATION group.
 *
 * @param {Object} groupClassification - Raw OptionGroup of type CLASSIFICATION
 * @returns {{ id: String, quantityScaleMethod: String }}
 */
function _extractProductRelatedComponent(groupClassification) {
    const prc = groupClassification?.components?.[0]?.productRelatedComponent;
    if (!prc?.id) {
        throw new Error(
            'ClassificationNodeBuilder: groupClassification.components[0].productRelatedComponent.id is required'
        );
    }
    return {
        id:                  prc.id,
        quantityScaleMethod: prc.quantityScaleMethod ?? 'Proportional'
    };
}
