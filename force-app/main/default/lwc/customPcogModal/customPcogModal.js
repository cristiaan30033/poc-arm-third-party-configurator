import { LightningElement, api, track } from 'lwc';


export default class CustomPcogModal extends LightningElement {
    @api products = [];
    @track searchTerm = '';
    selectedRows = new Set();

    get filteredProducts() {
        const term = (this.searchTerm || '').toLowerCase();
        if (!term) return this.products;
        return this.products.filter(p =>
            (p.code && p.code.toLowerCase().includes(term)) ||
            (p.name && p.name.toLowerCase().includes(term))
        );
    }

    get hasSelection() {
        return this.selectedRows.size > 0;
    }
    get notHasSelection() {
        return this.selectedRows.size === 0;
    }

    handleSearchInput(event) {
        this.searchTerm = event.target.value;
    }

    handleRowSelect(event) {
        const id = event.target.value;
        if (event.target.checked) {
            this.selectedRows.add(id);
        } else {
            this.selectedRows.delete(id);
        }
        this.selectedRows = new Set(this.selectedRows); // trigger reactivity
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('closemodal'));
    }

    handleAdd() {
        const selected = this.products.filter(p => this.selectedRows.has(p.id));
        this.dispatchEvent(new CustomEvent('additems', { detail: selected }));
    }
}