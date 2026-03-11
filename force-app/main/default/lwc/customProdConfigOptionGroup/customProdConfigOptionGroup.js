import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { subscribe, MessageContext, unsubscribe, publish } from 'lightning/messageService';
import NotificationMessageChannel from "@salesforce/messageChannel/lightning__productConfigurator_notification"
import { gql, graphql } from "lightning/graphql";
import { ClassificationNodeBuilder } from 'c/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Valid values for the optionGroupsDisplayStyle @api property.
 * These match the values documented in the Flow xml targetConfig.
 */
const DISPLAY_STYLE = Object.freeze({
    TABS: 'tabs',
    ACCORDIONS: 'accordions'
});

/**
 * Icons used for the expand/collapse toggle button on each option row.
 */
const TOGGLE_ICONS = Object.freeze({
    EXPANDED: 'utility:chevronup',
    COLLAPSED: 'utility:chevrondown'
});

/**
 * Discriminates the three rendering variants of an OptionGroup.
 * Determined from the group's childGroups and classifications arrays.
 *
 * SIMPLE:         childGroups: [], classifications: []        (e.g. Extras)
 * CLASSIFICATION: childGroups: [], classifications: [{id}]   (e.g. Starlink Utils CG)
 * CONTAINER:      childGroups: [...]                          (e.g. Other Group)
 */
const GROUP_TYPES = Object.freeze({
    SIMPLE:         'simple',
    CLASSIFICATION: 'classification',
    CONTAINER:      'container'
});

/**
 * LMS event type identifiers published to lightning__productConfigurator_notification.
 * Reference: SF Industries CPQ Configurator notification channel.
 */
export const LMS_EVENTS = Object.freeze({
    VALUE_CHANGE: "valueChanged",
    NAVIGATE: "navigate",
    CLOSE_PREVIEW: "closePreview",
    TOGGLE_INSTANT_PRICING: "toggleInstantPricing",
    TOGGLE_RULES_VALIDATION: "toggleRulesValidation",
    TOGGLE_COMPACT_LAYOUT: "toggleCompactLayout",
    UPDATE_PRICES: "updatePrices",
    VALIDATE_PRODUCT: "validateProduct",
    CLONE_ITEMS: "cloneItems",
});

/**
 * Field names used when publishing VALUE_CHANGE events via LMS.
 * Maps to ProductConfig.SalesTransactionItem state fields.
 * Reference: https://help.salesforce.com/s/articleView?id=ind.product_configurator_data_types_for_configurator_user_interface.htm&type=5
 */
export const STATE_FIELDS = Object.freeze({
    IS_SELECTED: "isSelected",
    QUANTITY: "Quantity",
    ATTRIBUTE_FIELD: "AttributeField",
    PRODUCT_SELLING_MODEL: "ProductSellingModel",
    PRICING_TERM_UNIT: "PricingTermUnit",
    SUBSCRIPTION_TERM: "SubscriptionTerm",
    SELLING_MODEL_TYPE: "SellingModelType",
    PRICE_BOOK_ENTRY: "PricebookEntry",
    IS_DELETED: "Deleted",
    UNIT_PRICE: "UnitPrice",
    CUSTOM_PRODUCT_NAME: "CustomProductName"
});

/**
 * Navigation action types used when publishing NAVIGATE events via LMS.
 */
export const NAVIGATION_TYPES = Object.freeze({
    CONFIGURE: "configure",
    DONE: "done",
    CANCEL: "cancel",
    SAVE_AND_EXIT: "saveAndExit",
    JUMP: "jump",
    SEARCH: "search"
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default class CustomProdConfigOptionGroup extends LightningElement {

    // -----------------------------------------------------------------------
    // Private backing fields
    // Data Types reference:
    // https://help.salesforce.com/s/articleView?id=ind.product_configurator_data_types_for_configurator_user_interface.htm&type=5
    // -----------------------------------------------------------------------

    _optionGroups = null;            // (apex://ProductConfig.OptionGroup[])         Contains option groups with their child options.
    _isNonBlokingEnabled = false;    // (Boolean)                                     Whether Non Blocking validation is enabled.
    _isApiInProgress = false;        // (Boolean)                                     Whether an API call is currently in progress.
    _layoutMode = null;              // (String)                                      Compact or Standard layout mode.
    _searchResultOptionId = null;    // (String)                                      ID of the option selected from search.
    _currencyCode = null;            // (String)                                      ISO currency code for price formatting.
    _optionGroupsDisplayStyle = null;// (String)                                      Display style: "accordions" or "tabs".
    _isDesignTime = null;            // (Boolean)                                     Whether the component is rendered in preview mode.
    _salesTransactionItems = null;   // (apex://ProductConfig.SalesTransactionItem[]) Sales transaction item state per option.
    _configuratorContext = null;     // (apex://ProductConfig.ConfiguratorContext)     Configurator session context.

    /**
     * Map of SalesTransactionItem keyed by optionId for O(1) lookup.
     * Rebuilt whenever salesTransactionItems is set.
     * Shape: Map<optionId: String, SalesTransactionItem>
     */
    _stiMap = new Map();

    /**
     * Tracks which option IDs are currently in the expanded (open) state.
     * Using @track so mutations trigger re-render via getter recomputation.
     */
    @track _expandedOptions = new Set();

    /**
     * Tracks which child group IDs are currently collapsed.
     * Child groups are expanded by default; adding an ID here collapses them.
     */
    @track _collapsedChildGroups = new Set();

    /**
     * Modal view control
    */
    @track _showModal = false;

    /**
     * ID of the first classification in the CLASSIFICATION group.
     * Used as the reactive variable ($) for the Product2 GraphQL wire query.
     * Set automatically when optionGroups is populated.
     */
    @track _classificationId = null;


    // -----------------------------------------------------------------------
    // @api properties
    // -----------------------------------------------------------------------
    get showModal() {
        return this._showModal;
    }

    get modalProducts() {
        return this._modalProducts;
    }

    @api
    get optionGroups() {
        return this._optionGroups;
    }
    set optionGroups(value) {
        this._optionGroups = value;
        console.log('optionGroups seteado:', JSON.stringify(this._optionGroups));

        // Extract the classificationId from the first CLASSIFICATION group found.
        // This triggers the Product2 GraphQL @wire query reactively.
        const classificationGroup = (value ?? []).find(
            group => this._resolveGroupType(group) === GROUP_TYPES.CLASSIFICATION
        );
        this._classificationId = classificationGroup?.classifications?.[0]?.id ?? null;
        console.log('classificationId extraído:', this._classificationId);
    }

    @api
    get isNonBlokingEnabled() {
        return this._isNonBlokingEnabled;
    }
    set isNonBlokingEnabled(value) {
        this._isNonBlokingEnabled = value;
        console.log('isNonBlokingEnabled seteado:', this._isNonBlokingEnabled);
    }

    @api
    get isApiInProgress() {
        return this._isApiInProgress;
    }
    set isApiInProgress(value) {
        this._isApiInProgress = value;
        console.log('isApiInProgress seteado:', this._isApiInProgress);
    }

    @api
    get layoutMode() {
        return this._layoutMode;
    }
    set layoutMode(value) {
        this._layoutMode = value;
        console.log('layoutMode seteado:', this._layoutMode);
    }

    @api
    get searchResultOptionId() {
        return this._searchResultOptionId;
    }
    set searchResultOptionId(value) {
        this._searchResultOptionId = value;
        console.log('searchResultOptionId seteado:', this._searchResultOptionId);
    }

    @api
    get currencyCode() {
        return this._currencyCode;
    }
    set currencyCode(value) {
        this._currencyCode = value;
        console.log('currencyCode seteado:', this._currencyCode);
    }

    @api
    get optionGroupsDisplayStyle() {
        return this._optionGroupsDisplayStyle;
    }
    set optionGroupsDisplayStyle(value) {
        this._optionGroupsDisplayStyle = value;
        console.log('optionGroupsDisplayStyle seteado:', this._optionGroupsDisplayStyle);
    }

    @api
    get isDesignTime() {
        return this._isDesignTime;
    }
    set isDesignTime(value) {
        this._isDesignTime = value;
        console.log('isDesignTime seteado:', this._isDesignTime);
    }

    @api
    get salesTransactionItems() {
        return this._salesTransactionItems;
    }
    set salesTransactionItems(value) {
        this._salesTransactionItems = value;
        this._stiMap = this._buildSalesTransactionItemsMap(this._salesTransactionItems);
        console.log('salesTransactionItems seteado:', JSON.stringify(this._salesTransactionItems));
        console.log('salesTransactionItems map:', JSON.stringify(this._stiMap));
    }

    @api
    get configuratorContext() {
        return this._configuratorContext;
    }
    set configuratorContext(value) {
        this._configuratorContext = value;
        console.log('configuratorContext seteado:', JSON.stringify(this._configuratorContext));
    }

    // -----------------------------------------------------------------------
    // GraphQL — Product2 query for modal products
    // -----------------------------------------------------------------------
    /**
     * Products loaded via GraphQL, displayed in the add-products modal.
     * Shape: Array<{ id, name, code, description, type }>
     */
    @track _modalProducts = [];

    /**
     * Fetches Product2 records whose BasedOnId matches the classification ID
     * of the CLASSIFICATION group. The query re-runs automatically whenever
     * _classificationId changes (reactive $ variable).
     *
     * SOQL equivalent:
     *   SELECT Id, Name, BasedOn.Name, BasedOn.Code, Description, IsActive,
     *          ProductCode, Type
     *   FROM Product2
     *   WHERE BasedOnId = :_classificationId AND IsActive = TRUE
     */
    @wire(graphql, {
        query: gql`
            query getClassificationProducts($classificationId: ID) {
                uiapi {
                    query {
                        Product2(
                            first: 100
                            where: {
                                and: [
                                    { BasedOnId: { eq: $classificationId } }
                                    { IsActive: { eq: true } }
                                ]
                            }
                        ) {
                            totalCount
                            edges {
                                node {
                                    Id
                                    Name {
                                        value
                                    }
                                    Description {
                                        value
                                    }
                                    ProductCode {
                                        value
                                    }
                                    Type {
                                        value
                                    }
                                    BasedOn {
                                        Name {
                                            value
                                        }
                                        Code {
                                            value
                                        }
                                    }
                                    BasedOnId {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `,
        variables: '$_classificationQueryVars'
    })
    wiredClassificationProducts({ data, errors }) {
        if (data) {
            const edges = data.uiapi.query.Product2.edges ?? [];
            this._modalProducts = edges.map(({ node }) => ({
                id:          node.Id,
                name:        node.Name?.value,
                code:        node.ProductCode?.value,
                description: node.Description?.value,
                type:        node.Type?.value,
                basedOnName: node.BasedOn?.Name?.value,
                basedOnCode: node.BasedOn?.Code?.value,
                baseOnId:    node.BasedOnId?.value
            }));
            console.log(
                `[PCOG] Classification products loaded (${this._modalProducts.length}):`,
                JSON.stringify(this._modalProducts)
            );
        } else if (errors) {
            console.error('[PCOG] GraphQL error loading classification products:', JSON.stringify(errors));
            this._modalProducts = [];
            this.dispatchEvent(
                new ShowToastEvent({
                    title:   'Error loading products',
                    message: errors[0]?.message ?? 'Unknown GraphQL error',
                    variant: 'error'
                })
            );
        }
    }

    /**
     * Reactive variables object consumed by the Product2 @wire query.
     * Returns null when no classificationId is available, which prevents
     * the wire from firing until the data is ready.
     */
    get _classificationQueryVars() {
        if (!this._classificationId) return null;
        return { classificationId: this._classificationId };
    }

    // -----------------------------------------------------------------------
    // GraphQL — PricebookEntry query
    // Fires automatically once _modalProducts is populated.
    // -----------------------------------------------------------------------

    @track _pricebookEntries = [];

    @wire(graphql, {
        query: gql`
            query getPricebookEntries($productIds: [ID]) {
                uiapi {
                    query {
                        PricebookEntry(
                            first: 200
                            where: {
                                Product2Id: { in: $productIds }
                            }
                        ) {
                            totalCount
                            edges {
                                node {
                                    Id
                                    ProductCode {
                                        value
                                    }
                                    UnitPrice {
                                        value
                                    }
                                    Pricebook2Id {
                                        value
                                    }
                                    Product2Id {
                                        value
                                    }
                                    IsActive {
                                        value
                                    }
                                    ProductSellingModel {
                                        SellingModelType {
                                            value
                                        }
                                    }
                                    ProductSellingModelId {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `,
        variables: '$_pricebookQueryVars'
    })
    wiredPricebookEntries({ data, errors }) {
        if (data) {
            const edges = data.uiapi.query.PricebookEntry.edges ?? [];
            this._pricebookEntries = edges.map(({ node }) => ({
                id:                 node.Id,
                product2Id:         node.Product2Id?.value,
                pricebook2Id:       node.Pricebook2Id?.value,
                productCode:        node.ProductCode?.value,
                unitPrice:          node.UnitPrice?.value,
                isActive:           node.IsActive?.value,
                sellingModelType:   node.ProductSellingModel?.SellingModelType?.value,
                sellingModelId:     node.ProductSellingModelId?.value
            }));
            console.log(
                `[PCOG] PricebookEntries loaded (${this._pricebookEntries.length}):`,
                JSON.stringify(this._pricebookEntries)
            );
        } else if (errors) {
            console.error('[PCOG] GraphQL error loading PricebookEntries:', JSON.stringify(errors));
            this._pricebookEntries = [];
            this.dispatchEvent(
                new ShowToastEvent({
                    title:   'Error loading prices',
                    message: errors[0]?.message ?? 'Unknown GraphQL error',
                    variant: 'error'
                })
            );
        }
    }

    /**
     * Reactive variables for the PricebookEntry wire.
     * Returns null until _modalProducts has at least one item,
     * lo que evita que el wire se ejecute con un array vacío.
     */
    get _pricebookQueryVars() {
        if (!this._modalProducts?.length) return null;
        return {
            productIds: this._modalProducts.map(p => p.id)
        };
    }

    // -----------------------------------------------------------------------
    // LMS wiring
    // -----------------------------------------------------------------------

    @wire(MessageContext) messageContext;
    subscription;

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    connectedCallback() {
        this.subscription = subscribe(
            this.messageContext,
            NotificationMessageChannel,
            (msg) => { console.log('[LMS received]', JSON.stringify(msg)); }
        );
    }

    disconnectedCallback() {
        unsubscribe(this.subscription);
        this.subscription = null;
    }

    // -----------------------------------------------------------------------
    // Display mode getters
    // -----------------------------------------------------------------------

    /**
     * Returns true when the Flow-configured display style is "tabs".
     * Controls which block renders in the template.
     */
    get isTabsView() {
        return this._optionGroupsDisplayStyle === DISPLAY_STYLE.TABS;
    }

    /**
     * Returns true when the Flow-configured display style is "accordions".
     * Controls which block renders in the template.
     */
    get isAccordionView() {
        return this._optionGroupsDisplayStyle === DISPLAY_STYLE.ACCORDIONS;
    }

    /**
     * Returns an array of group IDs to keep all accordion sections open by default.
     * Used by lightning-accordion active-section-name.
     */
    get activeSections() {
        if (!this._optionGroups) return [];
        return this._optionGroups.map(group => group.id);
    }

    // -----------------------------------------------------------------------
    // Template view model getter
    // -----------------------------------------------------------------------

    /**
     * Returns the fully mapped view model array consumed by the template.
     * Each entry represents one group with its resolved option rows.
     *
     * NOTE: This getter is recomputed on every render cycle.
     * If performance is a concern at scale, move this computation into
     * the @api setters and store the result in a @track field.
     *
     * @returns {Array<GroupViewModel>}
     */
    get groups() {
        if (!this._optionGroups) return [];
        return this._optionGroups.map(group => this._buildGroupViewModel(group));
    }

    // -----------------------------------------------------------------------
    // Private view model builders
    // -----------------------------------------------------------------------

    /**
     * Classifies a raw OptionGroup into one of the three GROUP_TYPES
     * based on its childGroups and classifications arrays.
     *
     * The discriminator rules, derived from the OptionGroup DTO payload, are:
     *   - CONTAINER:      childGroups is non-empty  (checked first; takes precedence)
     *   - CLASSIFICATION: classifications is non-empty
     *   - SIMPLE:         both arrays are empty (default)
     *
     * @param {Object} group - Raw OptionGroup record
     * @returns {String} One of GROUP_TYPES values
     */
    _resolveGroupType(group) {
        if ((group.childGroups ?? []).length > 0) {
            return GROUP_TYPES.CONTAINER;
        }
        if ((group.classifications ?? []).length > 0) {
            return GROUP_TYPES.CLASSIFICATION;
        }
        return GROUP_TYPES.SIMPLE;
    }

    /**
     * Maps a raw ProductConfig.OptionGroup to a template-friendly view model.
     * Handles all three group types: simple, classification, and container.
     *
     * GroupViewModel shape:
     * {
     *   id:              String,
     *   label:           String,
     *   groupType:       String,          // one of GROUP_TYPES
     *   isSimple:        Boolean,
     *   isClassification:Boolean,
     *   isContainer:     Boolean,
     *   showAddButton:   Boolean,         // true only for CLASSIFICATION
     *   showSelectButton:Boolean,         // true only for CLASSIFICATION
     *   addButtonLabel:  String,
     *   selectButtonLabel:String,
     *   options:         OptionViewModel[], // empty for CONTAINER
     *   childGroups:     GroupViewModel[],  // populated only for CONTAINER
     *   isEmpty:         Boolean,
     *   emptyStateMessage:String,
     *   isRendered:      Boolean
     * }
     *
     * @param {Object} group - Raw OptionGroup record
     * @returns {GroupViewModel}
     */
    _buildGroupViewModel(group) {
        const groupType       = this._resolveGroupType(group);
        const isContainer     = groupType === GROUP_TYPES.CONTAINER;
        const isClassification = groupType === GROUP_TYPES.CLASSIFICATION;

        // Container groups delegate option rendering to their child view models;
        // their own components array is intentionally ignored.
        const visibleComponents = isContainer
            ? []
            : (group.components ?? []).filter(c => !c.isHidden);
        const options = visibleComponents.map(component => this._buildOptionViewModel(component));

        // Recursively resolve child groups for CONTAINER type only.
        const childGroups = isContainer
            ? (group.childGroups ?? []).map(child => this._buildGroupViewModel(child))
            : [];

        const isCollapsed = this._collapsedChildGroups.has(group.id);

        return {
            id:               group.id,
            label:            group.name,
            groupType,
            isSimple:         groupType === GROUP_TYPES.SIMPLE,
            isClassification,
            isContainer,
            isCollapsed,
            toggleIcon:       isCollapsed ? 'utility:chevronright' : 'utility:chevrondown',
            // "Add" button opens the modal to browse and pick products.
            // Only relevant for CLASSIFICATION groups (Case 2).
            showAddButton:    isClassification,
            showSelectButton: isClassification,
            addButtonLabel:   `Add ${group.name}`,
            selectButtonLabel:`Select ${group.name}`,
            options,
            childGroups,
            isEmpty:          options.length === 0,
            emptyStateMessage:`No items added to ${group.name} yet.`,
            // Guard used by the tabs template to skip rendering until the tab is active.
            isRendered:       true
        };
    }

    /**
     * Maps a raw Component record to a template-friendly view model,
     * merging live state from the matching SalesTransactionItem when available.
     *
     * Actual Component DTO shape (from group.components payload):
     * {
     *   id: String,
     *   name: String,
     *   description: String,
     *   isSelected: Boolean,
     *   quantity: Number,
     *   quantityReadOnly: Boolean,
     *   selectedPsm: String | null,           // selected ProductSellingModel ID
     *   isConfigurable: Boolean,
     *   isCustomProductNameEditable: Boolean,
     *   isCustomProductNameReadable: Boolean,
     *   productSellingModelOptions: Array<{
     *     id: String,
     *     productSellingModelId: String,
     *     productSellingModel: { id, name, sellingModelType, status }
     *   }>,
     *   prices: Array<{
     *     unitPrice: Number,
     *     isDefault: Boolean,
     *     pricingModel: { id: String, name: String }
     *   }>,
     *   nodeType: String,   // "simpleProduct" | "productClass"
     *   isHidden: Boolean
     * }
     *
     * @param {Object} component - Raw Component record from group.components
     * @returns {OptionViewModel}
     */
    _buildOptionViewModel(component) {
        const sti = this._stiMap.get(component.id);

        // isSelected lives on the component object, NOT in the STI payload.
        // Confirmed from STI payload: the field does not exist in the STI response.
        const isSelected = component.isSelected ?? false;
        const quantity   = sti?.[STATE_FIELDS.QUANTITY] ?? component.quantity ?? 1;

        // Resolve the active PSM: prefer STI (reflects user interaction), fallback to component snapshot.
        const selectedPsm = sti?.[STATE_FIELDS.PRODUCT_SELLING_MODEL] ?? component.selectedPsm ?? null;

        // Build the combobox options list from productSellingModelOptions.
        // Each entry becomes { label, value } compatible with lightning-combobox.
        const purchasingOptions = (component.productSellingModelOptions ?? []).map(psmo => ({
            label: psmo.productSellingModel.name,
            value: psmo.productSellingModelId
        }));

        // Resolve unit price. The STI carries UnitPrice directly as a root field.
        // Confirmed from STI payload: { "UnitPrice": 49, ... } for Printer, { "UnitPrice": null } for Monitor.
        // Fall back to component.prices resolution when the STI has no price yet.
        const unitPrice = sti?.[STATE_FIELDS.UNIT_PRICE] ?? this._resolveUnitPrice(component.prices, selectedPsm);

        const isExpanded = this._expandedOptions.has(component.id);

        return {
            id: component.id,
            // Prefer custom product name from STI if the user has renamed it.
            name: sti?.[STATE_FIELDS.CUSTOM_PRODUCT_NAME] || component.name,
            description: component.description,
            isSelected,
            purchasingOptions,
            selectedPurchasingOption: selectedPsm,
            quantity,
            // quantityReadOnly comes directly from the component DTO. When not present
            // in the DTO, fall back to disabling the field when the option is not selected.
            isQuantityDisabled: component.quantityReadOnly ?? !isSelected,
            // Price is displayed only when the option is selected and a PSM is chosen.
            hasPrice: isSelected && selectedPsm != null && unitPrice != null,
            totalPrice: unitPrice != null ? unitPrice * quantity : null,
            isExpanded,
            toggleIcon: isExpanded ? TOGGLE_ICONS.EXPANDED : TOGGLE_ICONS.COLLAPSED,
            isConfigurable: component.isConfigurable ?? false,
            isCustomProductNameEditable: component.isCustomProductNameEditable ?? false,
            // productKey is supplied by the configurator platform through the STI payload.
            // It is required by handleRemoveRow and handleConfigureRow when publishing
            // LMS events, and must be forwarded to child components via the item prop.
            productKey: sti?.productKey ?? null
        };
    }

    /**
     * Resolves the unit price for a component given the active PSM ID.
     * Looks for the price entry whose pricingModel.id matches the PSM.
     * Falls back to the default price entry when no PSM is selected.
     * Returns null when no matching price is found.
     *
     * @param {Array}         prices       - Component prices array
     * @param {String | null} selectedPsm  - Active ProductSellingModel ID
     * @returns {Number | null}
     */
    _resolveUnitPrice(prices, selectedPsm) {
        if (!prices || prices.length === 0) return null;

        if (selectedPsm) {
            const matched = prices.find(p => p.pricingModel?.id === selectedPsm);
            if (matched) return matched.unitPrice;
        }

        const defaultEntry = prices.find(p => p.isDefault) ?? prices[0];
        return defaultEntry?.unitPrice ?? null;
    }

    /**
     * Builds a Map<componentId, SalesTransactionItem> from the raw STI array.
     *
     * The join key is item.Product (Salesforce API Name convention, capital P).
     * This matches component.id from the optionGroups payload.
     *
     * Confirmed from salesTransactionItems payload:
     *   { "Product": "01tg7000000U1jaAAC", ... } -> component.id: "01tg7000000U1jaAAC"
     *
     * @param {Array} items - Raw SalesTransactionItem array
     * @returns {Map<String, Object>}
     */
    _buildSalesTransactionItemsMap(items) {
        const map = new Map();
        if (!items) return map;
        items.forEach(item => {
            // item.Product is the Salesforce API Name field (PascalCase).
            // It matches component.id used as the lookup key in _buildOptionViewModel.
            if (item.Product) {
                map.set(item.Product, item);
            }
        });
        return map;
    }


    // -----------------------------------------------------------------------
    // Event handlers - Group level
    // -----------------------------------------------------------------------

    /**
     * Handles the "Add <GroupName>" button click.
     * Publishes a NAVIGATE event with type SEARCH so the configurator
     * opens the product search panel for the given group.
     *
     * @param {Event} event
     */
    handleAddProduct(event) {
        const groupId = event.currentTarget.dataset.groupId;
        this._publishEvent(LMS_EVENTS.NAVIGATE, {
            type: NAVIGATION_TYPES.SEARCH,
            groupId
        });
    }

    /**
     * Handles the "Select <GroupName>" button click.
     * Publishes a CLONE_ITEMS event so the configurator
     * opens the clone/select flow for the given group.
     *
     * @param {Event} event
     */
    handleSelectProduct(event) {
        const groupId = event.currentTarget.dataset.groupId;
        this._publishEvent(LMS_EVENTS.CLONE_ITEMS, { groupId });
    }

    // -----------------------------------------------------------------------
    // Event handlers - Option level
    // -----------------------------------------------------------------------

    /**
     * Handles the option checkbox change.
     * Publishes a VALUE_CHANGE event updating the isSelected state field.
     *
     * @param {Event} event
     */
    handleOptionSelected(event) {
        const optionId  = event.detail.itemId;
        const isChecked = event.target.checked;
        this._publishValueChange(optionId, STATE_FIELDS.IS_SELECTED, isChecked);
    }

    /**
     * Handles the inline product name edit button click.
     * TODO: Implement inline edit UI (input overlay or modal) and
     * publish VALUE_CHANGE with STATE_FIELDS.CUSTOM_PRODUCT_NAME once confirmed.
     *
     * @param {Event} event
     */
    handleEditProductName(event) {
        const optionId = event.detail.itemId;
        // TODO: open inline text edit for this option row
        console.log('handleEditProductName - optionId:', optionId);
    }

    /**
     * Handles purchasing option combobox change.
     * Publishes a VALUE_CHANGE event updating the ProductSellingModel state field.
     *
     * @param {Event} event
     */
    handlePurchasingOptionChange(event) {
        const optionId = event.detail.itemId;
        const value    = event.detail.value;
        this._publishValueChange(optionId, STATE_FIELDS.PRODUCT_SELLING_MODEL, value);
    }

    /**
     * Handles quantity input change.
     * Publishes a VALUE_CHANGE event updating the Quantity state field.
     *
     * @param {Event} event
     */
    handleQuantityChange(event) {
        const optionId = event.detail.itemId;
        const value    = Number(event.detail.value);
        this._publishValueChange(optionId, STATE_FIELDS.QUANTITY, value);
    }

    /**
     * Handles the configure (settings) button click.
     * Publishes a NAVIGATE event with type CONFIGURE so the configurator
     * opens the option-level configuration panel.
     *
     * @param {Event} event
     */
    handleConfigure(event) {
        const optionId = event.detail.itemId;
        this._publishEvent(LMS_EVENTS.NAVIGATE, {
            type: NAVIGATION_TYPES.CONFIGURE,
            optionId
        });
    }

    /**
     * Handles the expand/collapse toggle button click on a child group header.
     * Child groups are expanded by default; clicking collapses/re-expands them.
     *
     * @param {Event} event
     */
    handleToggleChildGroup(event) {
        const groupId = event.currentTarget.dataset.groupId;

        if (this._collapsedChildGroups.has(groupId)) {
            this._collapsedChildGroups.delete(groupId);
        } else {
            this._collapsedChildGroups.add(groupId);
        }

        // Reassign to a new Set reference so @track picks up the mutation
        this._collapsedChildGroups = new Set(this._collapsedChildGroups);
    }

    /**
     * Handles the expand/collapse toggle button click on each option row.
     * Mutates the local _expandedOptions Set and reassigns it
     * so the @track decorator detects the change and triggers re-render.
     *
     * @param {Event} event
     */
    handleToggleExpand(event) {
        const optionId = event.detail.itemId;

        if (this._expandedOptions.has(optionId)) {
            this._expandedOptions.delete(optionId);
        } else {
            this._expandedOptions.add(optionId);
        }

        // Reassign to a new Set reference so @track picks up the mutation
        this._expandedOptions = new Set(this._expandedOptions);
    }


    handleConfigureRow = (event) => {

        if(this.isApiInProgress){
            // Prevent navigation when API call is in progress
            return;
        }
        const productKey = event.detail.item && event.detail.item.productKey;
        if (!productKey) return;

        publish(this.messageContext, NotificationMessageChannel, {
            action: LMS_EVENTS.NAVIGATE,
            type: NAVIGATION_TYPES.CONFIGURE,
            key: productKey           
        });

    };

    handleRemoveRow = (event) => {

        console.log('CustomProdConfigOptionGroup handleRemoveRow');
        console.log(JSON.stringify(event.detail));
        if(this.isApiInProgress){
            // Prevent navigation when API call is in progress
            return;
        }

        const productKey = event.detail && event.detail.productKey;
        if (!productKey) return;
        const eventData = [{
            key: productKey,
            field: STATE_FIELDS.IS_SELECTED,
            value: false
        }];
        publish(this.messageContext, NotificationMessageChannel, {
            action: LMS_EVENTS.VALUE_CHANGE,
            data: eventData
        });
    };

    /**
     * Opens the modal to browse and add products.
     * Bound to the "Add" button, which is only rendered for CLASSIFICATION groups.
     */
    handleShowModal() {
        console.log('customProdConfigOptionGroup :: openModal');
        this._showModal = true;
    }

    /**
     * Closes the modal without applying any selection.
     */
    handleCloseModal() {
        this._showModal = false;
    }

    //add items selected from child customPcogModal , this is connected to event fired from child ( add items when GROUP_TYPES.CLASSIFICATION)
    handleAddItems(event) {
        this._showModal = false;
        const selectedItems = event.detail;
        const group_classification = (this._optionGroups ?? []).find(group => this._resolveGroupType(group) === GROUP_TYPES.CLASSIFICATION);

        if (!group_classification) {
            console.warn('[PCOG] handleAddItems: no CLASSIFICATION group found in optionGroups');
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'CLASSIFICATION group found',
                    message: '[PCOG] handleAddItems: no CLASSIFICATION group found in optionGroups',
                    variant: 'error'
                })
            );

            return;
        }

        console.log('handleAddItems:', JSON.stringify(selectedItems));
        console.log('_pricebookEntries:', JSON.stringify(this._pricebookEntries));
        console.log('group_classification:', JSON.stringify(group_classification));
        // TODO: lógica para agregar los productos al grupo...
        // selectedItems and _pricebookEntries
        try {
            const prcId = group_classification?.components?.[0]?.productRelatedComponent.id;
            const prcQuantityScaleMethod = group_classification?.components?.[0]?.productRelatedComponent?.quantityScaleMethod ?? 'Proportional'

            const addedNodes = ClassificationNodeBuilder.addedNodes(selectedItems, this._pricebookEntries, prcId, prcQuantityScaleMethod, this._configuratorContext);
            console.log('handleAddItems addedNodes LMS published payload:' + JSON.stringify(addedNodes, null, 2));
            publish(this.messageContext, NotificationMessageChannel, {
                            action: LMS_EVENTS.VALUE_CHANGE,
                            data: [{
                                field: "addedNodes",
                                addedNodes
                            }]

            });
        } catch (error) {
            console.error('Error creating payload:', error.message);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error adding items',
                    message: error.message,
                    variant: 'error'
                })
            );
        }
    }

    /**
     * Handles the additem event from c-custom-pcog-item.
     * Fired when the checkbox transitions from unchecked to checked for a
     * SIMPLE or CONTAINER group product.
     *
     * Although these products are pre-defined in the bundle, they still require
     * a full addedNodes payload (LineItem + Relationship nodes) to be created
     * in the SalesTransaction — the same mechanism used by CLASSIFICATION groups.
     * The difference is that all required data (pricebook, prc, product metadata)
     * is sourced directly from the raw component found in _optionGroups, rather
     * than from a modal selection.
     *
     * @param {CustomEvent} event - event.detail is the full item view model from c-custom-pcog-item
     */
    handleAddItem(event) {
        if (this._isApiInProgress) {
            return;
        }

        const item = event.detail;
        if (!item?.id) {
            console.warn('[PCOG] handleAddItem: event.detail.id is missing');
            return;
        }

        // Find the raw component from _optionGroups to access its full metadata
        // (prices, productRelatedComponent, productSellingModelOptions, additionalFields).
        // The view model (item) only carries display fields; the raw component has everything.
        const rawComponent = this._findRawComponent(item.id);
        if (!rawComponent) {
            console.warn('[PCOG] handleAddItem: raw component not found for id:', item.id);
            return;
        }

        const prc = rawComponent.productRelatedComponent;
        if (!prc?.id) {
            console.warn('[PCOG] handleAddItem: productRelatedComponent.id missing for component:', item.id);
            return;
        }

        // Shape the selected product to match the signature expected by addedNodes:
        //   { id, name, code, baseOnId, quantity? }
        // additionalFields carries BasedOnId under contextAttributeApiName "ProductBasedOn".
        const basedOnField = (rawComponent.additionalFields ?? []).find(
            f => f.contextAttributeApiName === 'ProductBasedOn'
        );
        const selectedProducts = [{
            id:        rawComponent.id,
            name:      rawComponent.name,
            code:      rawComponent.productCode,
            baseOnId:  basedOnField?.value ?? null,
            quantity:  rawComponent.quantity ?? 1
        }];

        // Build a pricebook entries array in the shape PricebookEntryResolver expects:
        //   { id, product2Id, sellingModelId, sellingModelType, unitPrice }
        // Derived by joining component.prices (has pricebookEntryId + pricingModel.id as sellingModelId)
        // with component.productSellingModelOptions (has sellingModelType per sellingModelId).
        const pricebookEntries = this._buildPricebookEntriesFromComponent(rawComponent);

        try {
            const addedNodes = ClassificationNodeBuilder.addedNodes(
                selectedProducts,
                pricebookEntries,
                prc.id,
                prc.quantityScaleMethod ?? 'Proportional',
                this._configuratorContext
            );

            console.log('[PCOG] handleAddItem addedNodes payload:', JSON.stringify(addedNodes, null, 2));

            publish(this.messageContext, NotificationMessageChannel, {
                action: LMS_EVENTS.VALUE_CHANGE,
                data: [{
                    field:      'addedNodes',
                    addedNodes
                }]
            });
        } catch (error) {
            console.error('[PCOG] handleAddItem error building payload:', error.message);
            this.dispatchEvent(
                new ShowToastEvent({
                    title:   'Error adding item',
                    message: error.message,
                    variant: 'error'
                })
            );
        }
    }
    
    // -----------------------------------------------------------------------
    // Private component lookup helpers
    // -----------------------------------------------------------------------

    /**
     * Searches _optionGroups for the raw component matching the given id.
     * Covers both SIMPLE groups (group.components) and CONTAINER groups
     * (group.childGroups[n].components).
     *
     * @param {String} componentId - component.id (product2Id)
     * @returns {Object|null} Raw component record or null when not found
     */
    _findRawComponent(componentId) {
        for (const group of (this._optionGroups ?? [])) {
            // SIMPLE / CLASSIFICATION: components live directly on the group
            const direct = (group.components ?? []).find(c => c.id === componentId);
            if (direct) return direct;

            // CONTAINER: components are nested inside childGroups
            for (const child of (group.childGroups ?? [])) {
                const nested = (child.components ?? []).find(c => c.id === componentId);
                if (nested) return nested;
            }
        }
        return null;
    }

    /**
     * Derives a pricebook entries array from a raw component's prices and
     * productSellingModelOptions arrays. The resulting shape matches what
     * PricebookEntryResolver (inside ClassificationNodeBuilder) expects:
     *   { id, product2Id, sellingModelId, sellingModelType, unitPrice }
     *
     * Join key: price.pricingModel.id === psmo.productSellingModelId
     *
     * @param {Object} component - Raw component from _optionGroups
     * @returns {Object[]}
     */
    _buildPricebookEntriesFromComponent(component) {
        const psmOptions = component.productSellingModelOptions ?? [];
        // Index PSM options by sellingModelId for O(1) lookup.
        const psmIndex = new Map(psmOptions.map(psmo => [psmo.productSellingModelId, psmo]));

        return (component.prices ?? [])
            .filter(price => price.pricebookEntryId)
            .map(price => {
                const sellingModelId = price.pricingModel?.id ?? null;
                const psmo           = psmIndex.get(sellingModelId);
                return {
                    id:               price.pricebookEntryId,
                    product2Id:       component.id,
                    sellingModelId,
                    sellingModelType: psmo?.productSellingModel?.sellingModelType ?? null,
                    unitPrice:        price.unitPrice ?? 0
                };
            });
    }

    // -----------------------------------------------------------------------
    // Private LMS helpers
    // -----------------------------------------------------------------------

    /**
     * Publishes a VALUE_CHANGE event for a single state field on an option.
     *
     * @param {String} optionId   - The option record ID
     * @param {String} fieldName  - One of STATE_FIELDS values
     * @param {*}      value      - The new field value
     */
    _publishValueChange(optionId, fieldName, value) {
        this._publishEvent(LMS_EVENTS.VALUE_CHANGE, {
            optionId,
            fieldName,
            value
        });
    }

    /**
     * Publishes a message to the lightning__productConfigurator_notification channel.
     *
     * @param {String} type    - One of LMS_EVENTS values
     * @param {Object} payload - Additional payload merged into the message
     */
    _publishEvent(type, payload) {
        publish(this.messageContext, NotificationMessageChannel, {
            type,
            ...payload
        });
    }
}