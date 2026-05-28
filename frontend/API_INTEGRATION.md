# STARK AI - Backend API Integration Guide

## Overview

The frontend is now integrated with your PostgreSQL backend through a comprehensive API service layer. This document explains how the integration works and how to extend it.

## Architecture

### API Service Layer (`client/src/lib/api.ts`)

All backend communication goes through the API service layer, which provides:
- **Type-safe API calls** with TypeScript interfaces
- **Error handling** and logging
- **Centralized endpoint management**
- **Easy to maintain and extend**

### Custom Hooks (`client/src/hooks/useApi.ts`)

Two main hooks for data management:

1. **`useApi<T>(fetchFn, options)`** - For fetching data
   - Handles loading, error, and data states
   - Supports auto-refetching at intervals
   - Returns refetch function for manual updates

2. **`useApiMutation<T, R>(mutationFn)`** - For form submissions
   - Handles loading state during submission
   - Captures and displays errors
   - Returns mutate function to trigger submission

## Environment Configuration

### Frontend Environment Variables

Create a `.env` file in the `client/` directory:

```env
VITE_API_URL=http://localhost:8080
```

For production (Vercel):
```env
VITE_API_URL=https://your-backend-domain.com
```

## API Endpoints

### Authentication
- `POST /login` - User login
  - Body: `{ username: string, password: string }`
  - Returns: `{ user: User }`

### Dashboard
- `GET /api/dashboard` - Get dashboard metrics
  - Returns: `DashboardMetrics`

### Masters
- `GET /api/branches` - List all branches
- `GET /api/items?category=raw_material|finished_good` - List items by category
- `GET /api/suppliers` - List all suppliers

### Transactions
- `POST /api/purchases` - Record purchase
- `POST /api/sales` - Record sale
- `POST /api/production` - Record production batch
- `POST /api/inventory/adjustment` - Stock adjustment
- `POST /api/waste` - Log waste
- `POST /api/damage` - Log damage
- `POST /api/expenses` - Record expense

### Approvals
- `GET /api/approvals/pending` - Get pending approvals
- `POST /api/approvals/:id/approve` - Approve request

### Reports
- `GET /api/reports/:reportType?format=json|pdf|csv` - Generate report

## Usage Examples

### Fetching Data

```typescript
import { useApi } from '@/hooks/useApi';
import { getDashboardMetrics } from '@/lib/api';

export default function Dashboard() {
  const { data, loading, error, refetch } = useApi(getDashboardMetrics, {
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <p>Total Sales: {data?.total_sales}</p>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### Form Submission

```typescript
import { useApiMutation } from '@/hooks/useApi';
import { addSale } from '@/lib/api';

export default function SalesForm() {
  const { mutate, loading, error } = useApiMutation(addSale);

  const handleSubmit = async (formData) => {
    const result = await mutate(formData);
    if (result) {
      console.log('Sale recorded successfully');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button disabled={loading}>
        {loading ? 'Saving...' : 'Save'}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
```

## Extending the API Service

### Adding a New Endpoint

1. **Add API function in `client/src/lib/api.ts`:**

```typescript
export async function getCustomData(): Promise<CustomData[]> {
  try {
    return await apiCall<CustomData[]>('/api/custom-endpoint');
  } catch (error) {
    console.error('Failed to fetch custom data:', error);
    return [];
  }
}
```

2. **Use in component:**

```typescript
const { data } = useApi(getCustomData);
```

### Adding a New Form

1. **Create form component:**

```typescript
import { useApiMutation } from '@/hooks/useApi';
import { addCustomData } from '@/lib/api';

export default function CustomForm() {
  const { mutate, loading, error } = useApiMutation(addCustomData);
  
  // Form implementation
}
```

## Backend Requirements

Your backend must provide:

1. **CORS Headers** - Allow requests from frontend origin
2. **JSON Responses** - All endpoints return JSON
3. **Error Handling** - Return appropriate HTTP status codes
4. **Authentication** - Session/token management for `/login`

### Example Backend Response Format

```python
# Success
{
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "Admin User",
    "role": "admin"
  }
}

# Error
{
  "error": "Invalid credentials"
}
```

## Testing the Integration

1. **Start your backend server:**
   ```bash
   python server.py
   ```

2. **Update `VITE_API_URL` in `.env`:**
   ```env
   VITE_API_URL=http://localhost:8080
   ```

3. **Start the frontend:**
   ```bash
   npm run dev
   ```

4. **Test API calls:**
   - Open browser DevTools (F12)
   - Go to Network tab
   - Navigate through the app
   - Verify API calls are being made

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:

1. **Backend must allow frontend origin:**
   ```python
   from flask_cors import CORS
   CORS(app, origins=["http://localhost:3000"])
   ```

2. **For production:**
   ```python
   CORS(app, origins=["https://your-frontend-domain.com"])
   ```

### API Calls Not Working

1. **Check `VITE_API_URL` environment variable**
2. **Verify backend is running on the correct port**
3. **Check browser Network tab for failed requests**
4. **Look at backend logs for errors**

### Authentication Issues

1. **Ensure `/login` endpoint exists and returns user object**
2. **Check session/token management in backend**
3. **Verify user credentials in database**

## Next Steps

1. **Connect all remaining pages** to real API endpoints
2. **Implement authentication context** for user state management
3. **Add error boundaries** for better error handling
4. **Implement data caching** to reduce API calls
5. **Add loading skeletons** for better UX
6. **Set up API request logging** for debugging

## Performance Optimization

### Caching

```typescript
// Cache data for 5 minutes
const { data } = useApi(getDashboardMetrics, {
  refetchInterval: 5 * 60 * 1000,
});
```

### Pagination

For large datasets, implement pagination:

```typescript
export async function getItems(page: number, limit: number): Promise<Item[]> {
  return await apiCall<Item[]>(`/api/items?page=${page}&limit=${limit}`);
}
```

### Lazy Loading

Load data only when needed:

```typescript
const { data } = useApi(getDashboardMetrics, {
  skip: !isVisible, // Only fetch when visible
});
```

## Security Considerations

1. **Never store sensitive data in localStorage**
2. **Use HTTPS in production**
3. **Validate all user inputs on frontend and backend**
4. **Implement proper authentication and authorization**
5. **Use environment variables for API URLs**
6. **Implement rate limiting on backend**
