import { supabase } from '@/integrations/supabase/client';
import { ContainerData } from '@/types/container';

export interface DbContainer {
  id: string;
  user_id: string;
  container_number: string;
  shipping_line: string | null;
  current_location: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  eta: string | null;
  last_update: string | null;
  status: string;
  origin_port: string | null;
  destination_port: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Convert database container to app format
export const dbToContainerData = (db: DbContainer): ContainerData => ({
  containerNumber: db.container_number,
  shippingLine: db.shipping_line || '',
  currentLocation: db.current_location || '',
  vesselName: db.vessel_name || '',
  voyageNumber: db.voyage_number || '',
  eta: db.eta || '',
  lastUpdate: db.last_update || '',
  status: (db.status as ContainerData['status']) || 'Pending',
  destinationPort: db.destination_port || undefined,
  error: db.error || undefined,
});

// Convert app container to database format (for insert/update)
export const containerDataToDb = (container: ContainerData, userId: string) => ({
  user_id: userId,
  container_number: container.containerNumber,
  shipping_line: container.shippingLine || null,
  current_location: container.currentLocation || null,
  vessel_name: container.vesselName || null,
  voyage_number: container.voyageNumber || null,
  eta: container.eta || null,
  last_update: container.lastUpdate || null,
  status: container.status,
  origin_port: null,
  destination_port: container.destinationPort || null,
  error: container.error || null,
});

// Fetch all containers for the current user
export const fetchUserContainers = async (): Promise<ContainerData[]> => {
  const { data, error } = await supabase
    .from('tracked_containers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching containers:', error);
    throw error;
  }

  return (data as DbContainer[]).map(dbToContainerData);
};

// Upsert a container (insert or update)
export const upsertContainer = async (container: ContainerData, userId: string): Promise<void> => {
  const dbData = containerDataToDb(container, userId);

  const { error } = await supabase
    .from('tracked_containers')
    .upsert(dbData, { 
      onConflict: 'user_id,container_number',
      ignoreDuplicates: false 
    });

  if (error) {
    console.error('Error upserting container:', error);
    throw error;
  }
};

// Upsert multiple containers
export const upsertContainers = async (containers: ContainerData[], userId: string): Promise<void> => {
  const dbData = containers.map(c => containerDataToDb(c, userId));

  const { error } = await supabase
    .from('tracked_containers')
    .upsert(dbData, { 
      onConflict: 'user_id,container_number',
      ignoreDuplicates: false 
    });

  if (error) {
    console.error('Error upserting containers:', error);
    throw error;
  }
};

// Delete a container
export const deleteContainer = async (containerNumber: string): Promise<void> => {
  const { error } = await supabase
    .from('tracked_containers')
    .delete()
    .eq('container_number', containerNumber);

  if (error) {
    console.error('Error deleting container:', error);
    throw error;
  }
};

// Delete multiple containers by container numbers
export const deleteContainers = async (containerNumbers: string[]): Promise<void> => {
  if (containerNumbers.length === 0) return;

  const { error } = await supabase
    .from('tracked_containers')
    .delete()
    .in('container_number', containerNumbers);

  if (error) {
    console.error('Error deleting containers:', error);
    throw error;
  }
};

// Delete all containers for current user
export const deleteAllContainers = async (): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from('tracked_containers')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.error('Error deleting all containers:', error);
    throw error;
  }
};
