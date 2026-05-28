import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { getBranches, getItems, addSale } from '@/lib/api';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface SalesFormProps {
  onSuccess?: () => void;
}

export default function SalesForm({ onSuccess }: SalesFormProps) {
  const [formData, setFormData] = useState({
    branch_id: '',
    item_id: '',
    entry_date: new Date().toISOString().split('T')[0],
    quantity: '',
    unit_price: '',
    discount_amount: '0',
    promotion_amount: '0',
    tax_amount: '0',
    payment_method: 'cash',
    receivable: '0',
    notes: '',
  });

  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { data: branches, loading: branchesLoading } = useApi(getBranches);
  const { data: items, loading: itemsLoading } = useApi(() => getItems('finished_good'));
  const { mutate: submitSale, loading: submitting } = useApiMutation(addSale);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    // Validation
    if (!formData.branch_id || !formData.item_id || !formData.quantity || !formData.unit_price) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    const result = await submitSale({
      branch_id: parseInt(formData.branch_id),
      item_id: parseInt(formData.item_id),
      entry_date: formData.entry_date,
      quantity: parseFloat(formData.quantity),
      unit_price: parseFloat(formData.unit_price),
      discount_amount: parseFloat(formData.discount_amount),
      promotion_amount: parseFloat(formData.promotion_amount),
      tax_amount: parseFloat(formData.tax_amount),
      payment_method: formData.payment_method,
      receivable: parseFloat(formData.receivable),
      notes: formData.notes,
      user_id: 1, // TODO: Get from auth context
    });

    if (result) {
      setSuccessMessage('Sale recorded successfully!');
      setFormData({
        branch_id: '',
        item_id: '',
        entry_date: new Date().toISOString().split('T')[0],
        quantity: '',
        unit_price: '',
        discount_amount: '0',
        promotion_amount: '0',
        tax_amount: '0',
        payment_method: 'cash',
        receivable: '0',
        notes: '',
      });
      onSuccess?.();
    } else {
      setErrorMessage('Failed to record sale. Please try again.');
    }
  };

  const grossAmount = (parseFloat(formData.quantity) || 0) * (parseFloat(formData.unit_price) || 0);
  const netAmount = grossAmount - (parseFloat(formData.discount_amount) || 0) - (parseFloat(formData.promotion_amount) || 0) + (parseFloat(formData.tax_amount) || 0);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Record Sale</h2>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-800">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm text-red-800">{errorMessage}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Branch */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Branch *</label>
            <select
              name="branch_id"
              value={formData.branch_id}
              onChange={handleChange}
              disabled={branchesLoading}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              <option value="">Select branch</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          {/* Item */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Item *</label>
            <select
              name="item_id"
              value={formData.item_id}
              onChange={handleChange}
              disabled={itemsLoading}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              <option value="">Select item</option>
              {items?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Date *</label>
            <input
              type="date"
              name="entry_date"
              value={formData.entry_date}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Quantity *</label>
            <input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              step="0.01"
              min="0.01"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          {/* Unit Price */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Unit Price *</label>
            <input
              type="number"
              name="unit_price"
              value={formData.unit_price}
              onChange={handleChange}
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          {/* Discount */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Discount</label>
            <input
              type="number"
              name="discount_amount"
              value={formData.discount_amount}
              onChange={handleChange}
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Promotion */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Promotion</label>
            <input
              type="number"
              name="promotion_amount"
              value={formData.promotion_amount}
              onChange={handleChange}
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Tax */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tax/VAT</label>
            <input
              type="number"
              name="tax_amount"
              value={formData.tax_amount}
              onChange={handleChange}
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Payment Method</label>
            <select
              name="payment_method"
              value={formData.payment_method}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Summary */}
        <div className="p-4 bg-secondary/50 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Gross Amount</p>
              <p className="text-lg font-bold text-foreground">₹{grossAmount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Discount/Promo</p>
              <p className="text-lg font-bold text-red-600">-₹{((parseFloat(formData.discount_amount) || 0) + (parseFloat(formData.promotion_amount) || 0)).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tax</p>
              <p className="text-lg font-bold text-foreground">+₹{(parseFloat(formData.tax_amount) || 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Amount</p>
              <p className="text-lg font-bold text-primary">₹{netAmount.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={submitting}
          className="w-full"
        >
          {submitting ? 'Saving...' : 'Record Sale'}
        </Button>
      </form>
    </Card>
  );
}
