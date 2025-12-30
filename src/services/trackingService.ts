import { supabase } from '@/integrations/supabase/client';
import { ContainerData, TrackingResult } from '@/types/container';

export async function trackContainer(containerNumber: string): Promise<TrackingResult> {
  try {
    const { data, error } = await supabase.functions.invoke('track-container', {
      body: { containerNumber }
    });

    if (error) {
      console.error('Edge function error:', error);
      return {
        success: false,
        error: error.message || 'Failed to track container',
        data: {
          containerNumber,
          shippingLine: '',
          currentLocation: '',
          vesselName: '',
          voyageNumber: '',
          eta: '',
          lastUpdate: '',
          status: 'Not Available',
          error: 'Tracking failed'
        }
      };
    }

    return data as TrackingResult;
  } catch (err) {
    console.error('Tracking error:', err);
    return {
      success: false,
      error: 'Network error',
      data: {
        containerNumber,
        shippingLine: '',
        currentLocation: '',
        vesselName: '',
        voyageNumber: '',
        eta: '',
        lastUpdate: '',
        status: 'Not Available',
        error: 'Network error'
      }
    };
  }
}

export async function trackContainers(
  containerNumbers: string[],
  onProgress: (completed: number, data: ContainerData) => void
): Promise<ContainerData[]> {
  const results: ContainerData[] = [];
  
  // Process containers in batches to avoid overwhelming the API
  const batchSize = 3;
  
  for (let i = 0; i < containerNumbers.length; i += batchSize) {
    const batch = containerNumbers.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (containerNumber, batchIndex) => {
      const result = await trackContainer(containerNumber);
      const containerData = result.data || {
        containerNumber,
        shippingLine: '',
        currentLocation: '',
        vesselName: '',
        voyageNumber: '',
        eta: '',
        lastUpdate: '',
        status: 'Not Available' as const,
        error: result.error
      };
      
      onProgress(i + batchIndex + 1, containerData);
      return containerData;
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}
