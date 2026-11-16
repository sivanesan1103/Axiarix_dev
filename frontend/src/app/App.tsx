import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { FilterProvider } from '@/contexts/FilterContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { errorMessage } from '@/api/client';
import { router } from '@/routes/router';

/** Global error handling: failed mutations surface a toast unless the caller handles them. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (count, err) => count < 1 && !String((err as { response?: { status?: number } })?.response?.status ?? '').startsWith('4'), refetchOnWindowFocus: false },
  },
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (!mutation.options.onError) toast.error(errorMessage(err));
    },
  }),
});

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FilterProvider>
            <RouterProvider router={router} />
            <ThemedToaster />
          </FilterProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
