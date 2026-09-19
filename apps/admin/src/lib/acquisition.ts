import { prisma } from '@tactia/database';
import { AcquisitionLeadService } from '@tactia/domain';

export const acquisitionLeadService = new AcquisitionLeadService(prisma);
