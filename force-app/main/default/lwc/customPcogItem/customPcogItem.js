import { LightningElement, api } from 'lwc';

export default class CustomPcogItem extends LightningElement {

    @api item;
    @api isApiInProgress;

    /**
     * True when the checkbox must be locked.
     * Applies while an API call is in progress to prevent concurrent state changes.
     */
    get isCheckboxDisabled() {
        return !!this.isApiInProgress;
    }

    /**
     * True when all row controls except the checkbox must be locked.
     * Applies when the item is not selected or an API call is in progress.
     * Controls: edit name button, purchasing option combobox,
     *           quantity input, configure button.
     */
    get isControlsDisabled() {
        return !this.item?.isSelected || !!this.isApiInProgress;
    }

    /**
     * Quantity input disabled state.
     * Respects both the component-level quantityReadOnly flag and the
     * general controls disabled rule (not selected or API in progress).
     */
    get isQuantityDisabled() {
        return this.item?.isQuantityDisabled || this.isControlsDisabled;
    }

    handleCheckboxChange(event) {
        
        // Fire event if unchecked
        if (!event.target.checked) {
            console.log('customPcogItem :: handleCheckboxChange: unchecked');
            const productKey = this.item?.productKey;
            this.dispatchEvent(new CustomEvent('removeitem', {
                detail: { productKey },
                bubbles: true,
                composed: true
            }));
        }
        // Fire event if checked (para disparar checked el estado previo  debe ser unchecked, por lo tanto este evento solo se ejecutara desde unchecked => checked para los GROUP_TYPES SIMPLE y CONTAINER, por que para CLASSIFICATION los items son agregados por el modal )
        if (event.target.checked) {
            console.log('customPcogItem :: handleCheckboxChange: checked');
            this.dispatchEvent(new CustomEvent('additem', {
                detail: this.item,
                bubbles: true,
                composed: true
            }));
        }
        console.log('customPcogItem :: handleCheckboxChange: ' + JSON.stringify(this.item));
    }

    handleConfigureClick() {
        // Log the item and fire a custom event
        // eslint-disable-next-line no-console
        //console.log('Configure clicked, item:', JSON.stringify(this.item));
        this.dispatchEvent(new CustomEvent('configure', {
            detail: { item: this.item },
            bubbles: true,
            composed: true
        }));
    }

    handleEditProductNameClick() {
    this.dispatchEvent(new CustomEvent('editproductname', {
        detail: { itemId: this.item.id },
        bubbles: true,
        composed: true
        }));
    }

    handlePurchasingOptionChange(event) {
        this.dispatchEvent(new CustomEvent('purchasingoptionchange', {
            detail: { itemId: this.item.id, value: event.detail.value },
            bubbles: true,
            composed: true
        }));
    }

    handleQuantityChange(event) {
        this.dispatchEvent(new CustomEvent('quantitychange', {
            detail: { itemId: this.item.id, value: Number(event.detail.value) },
            bubbles: true,
            composed: true
        }));
    }

    handleToggleExpand() {
        // eslint-disable-next-line no-console
        console.log('Toggle expand clicked, item:', JSON.stringify(this.item));
        this.dispatchEvent(new CustomEvent('toggleexpand', {
            detail: { itemId: this.item.id },
            bubbles: true,
            composed: true
        }));
    }

}