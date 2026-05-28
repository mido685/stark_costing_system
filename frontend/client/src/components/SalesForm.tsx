import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { getBranches, getItems, addSale } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface SalesFormProps {
  onSuccess?: () => void;
}

export default function SalesForm({ onSuccess }: SalesFormProps) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();

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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!formData.branch_id || !formData.item_id || !formData.quantity || !formData.unit_price) {
      setErrorMessage(t('proc.err.branch') + ' / ' + t('proc.err.ingredient'));
      return;
    }

    const result = await submitSale({
      branch_id:        parseInt(formData.branch_id),
      item_id:          parseInt(formData.item_id),
      entry_date:       formData.entry_date,
      quantity:         parseFloat(formData.quantity),
      unit_price:       parseFloat(formData.unit_price),
      discount_amount:  parseFloat(formData.discount_amount),
      promotion_amount: parseFloat(formData.promotion_amount),
      tax_amount:       parseFloat(formData.tax_amount),
      payment_method:   formData.payment_method,
      receivable:       parseFloat(formData.receivable),
      notes:            formData.notes,
      user_id:          user?.id ?? 0,
    });

    if (result) {
      setSuccessMessage(t('proc.ops.purchase') + ' — ' + t('common.save'));
      setFormData({
        branch_id:        '',
        item_id:          '',
        entry_date:       new Date().toISOString().split('T')[0],
        quantity:         '',
        unit_price:       '',
        discount_amount:  '0',
        promotion_amount: '0',
        tax_amount:       '0',
        payment_method:   'cash',
        receivable:       '0',
        notes:            '',
      });
      onSuccess?.();
    } else {
      setErrorMessage(t('proc.err.savePurchase'));
    }
  };

  const grossAmount =
    (parseFloat(formData.quantity) || 0) * (parseFloat(formData.unit_price) || 0);
  const netAmount =
    grossAmount
    - (parseFloat(formData.discount_amount)  || 0)
    - (parseFloat(formData.promotion_amount) || 0)
    + (parseFloat(formData.tax_amount)       || 0);

  // EGP symbol — matches the rest of the app ("All amounts in EGP")
  const currency = 'EGP';

  return (
    <Card className="p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <h2 className="text-lg font-semibold text-foreground mb-4">
        {t('nav.sales')}
      </h2>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-800">{errorMessage}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Branch */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.branch')}
            </label>
            <select
              name="branch_id"
              value={formData.branch_id}
              onChange={handleChange}
              disabled={branchesLoading}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              <option value="">{t('proc.ph.selectBranch')}</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          {/* Item */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.ingredient')}
            </label>
            <select
              name="item_id"
              value={formData.item_id}
              onChange={handleChange}
              disabled={itemsLoading}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              <option value="">{t('proc.ph.selectIngredient')}</option>
              {items?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.date')}
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.quantity')}
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.unitCostShort')}
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {/* No dedicated "discount" key — reuse the summary label */}
              {t('proc.summary.gross').replace('Gross', 'Discount') /* fallback */}
              {/* Safer: hardcode the label via a translation key if added later */}
              Discount
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              Promotion
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('proc.field.taxAmount').replace(' ({currency})', '')}
            </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {/* reuse finance activity "type" or a generic label */}
              {t('finance.activity.type')}
            </label>
            <select
              name="payment_method"
              value={formData.payment_method}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="cash">{isRTL ? 'نقداً' : 'Cash'}</option>
              <option value="bank">{isRTL ? 'تحويل بنكي' : 'Bank Transfer'}</option>
              <option value="credit">{isRTL ? 'آجل' : 'Credit'}</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            {t('proc.field.notes')}
          </label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            placeholder={t('proc.ph.notes')}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Summary */}
        <div className="p-4 bg-secondary/50 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{t('proc.summary.gross')}</p>
              <p className="text-lg font-bold text-foreground">
                {currency} {grossAmount.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {isRTL ? 'خصم / عروض' : 'Discount / Promo'}
              </p>
              <p className="text-lg font-bold text-red-600">
                -{currency}{' '}
                {(
                  (parseFloat(formData.discount_amount)  || 0) +
                  (parseFloat(formData.promotion_amount) || 0)
                ).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('proc.field.taxAmount').replace(' ({currency})', '')}</p>
              <p className="text-lg font-bold text-foreground">
                +{currency} {(parseFloat(formData.tax_amount) || 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('proc.summary.payable')}</p>
              <p className="text-lg font-bold text-primary">
                {currency} {netAmount.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Submit */}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('common.loading') : t('nav.sales')}
        </Button>
      </form>
    </Card>
  );
}