import { useState, useCallback, useEffect } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useFetcher, useLoaderData, Link } from '@remix-run/react';
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Banner,
  Divider,
  Select,
  Checkbox,
  Box,
} from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '~/shopify.server';
import { PrismaClient } from '@prisma/client';
import { getPriorityOrderStats } from '~/services/priority';
import { getCronJobStatus, triggerManualBilling } from '~/services/cron';
import { getActiveSubscription, updateCappedAmount } from '~/services/billing';
import { createShopifyGraphQLClient } from '~/services/shopify';
import { calculateSLA, getSLAMessage, isPriorityHandlingAvailable, getTimeUntilCutoff } from '~/services/sla';

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  
  // Get shop settings
  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  
  if (!shop) {
    throw new Error('Shop not found');
  }

  // Get priority order statistics
  const stats = await getPriorityOrderStats(prisma, shop.id, 30);
  const todayStats = await getPriorityOrderStats(prisma, shop.id, 1);
  const weekStats = await getPriorityOrderStats(prisma, shop.id, 7);

  // Get recent usage records
  const recentUsage = await prisma.dailyUsage.findMany({
    where: { shopId: shop.id },
    orderBy: { yyyymmdd: 'desc' },
    take: 7,
  });

  // Get cron job status
  const cronStatus = getCronJobStatus();

  // Get subscription info
  const client = createShopifyGraphQLClient(session.shop, session.accessToken);
  const subscription = await getActiveSubscription(client);

  // Get current SLA information
  const slaInfo = calculateSLA(shop.timezone);
  const slaMessage = getSLAMessage(shop.timezone);
  const isCurrentlyAvailable = isPriorityHandlingAvailable(shop.timezone);
  const timeUntilCutoff = getTimeUntilCutoff(shop.timezone);

  return json({
    shop: {
      id: shop.id,
      domain: shop.domain,
      currency: shop.currency,
      timezone: shop.timezone,
      billingCapCents: shop.billingCapCents,
      feeCents: shop.feeCents,
      slaHours: shop.slaHours,
    },
    stats: {
      today: todayStats,
      week: weekStats,
      month: stats,
    },
    recentUsage,
    cronStatus,
    subscription,
    slaInfo,
    slaMessage,
    isCurrentlyAvailable,
    timeUntilCutoff,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  try {
    if (action === 'updateSettings') {
      const feeCents = parseInt(formData.get('feeCents') as string);
      const slaHours = parseInt(formData.get('slaHours') as string);
      const billingCapCents = parseInt(formData.get('billingCapCents') as string);
      const enabled = formData.get('enabled') === 'true';

      await prisma.shop.update({
        where: { domain: session.shop },
        data: {
          feeCents: enabled ? feeCents : 0, // Set to 0 when disabled
          slaHours,
          billingCapCents,
        },
      });

      return json({ 
        success: true, 
        message: enabled ? 'Priority Handling enabled and settings updated!' : 'Priority Handling disabled successfully'
      });
    }

    if (action === 'updateBillingCap') {
      const newCapCents = parseInt(formData.get('billingCapCents') as string);
      
      const confirmationUrl = await updateCappedAmount(
        session.shop,
        session.accessToken,
        newCapCents
      );

      return json({ 
        success: true, 
        message: 'Billing cap update initiated',
        confirmationUrl 
      });
    }

    if (action === 'triggerBilling') {
      const result = await triggerManualBilling(prisma);
      return json({ 
        success: true, 
        message: `Manual billing completed: ${result.message}`,
        result 
      });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Settings action error:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

export default function Settings() {
  const { shop, stats, recentUsage, cronStatus, subscription, slaInfo, slaMessage, isCurrentlyAvailable, timeUntilCutoff } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [slaHours, setSlaHours] = useState(shop.slaHours.toString());
  const [billingCapCents, setBillingCapCents] = useState(shop.billingCapCents.toString());
  const [enabled, setEnabled] = useState(shop.feeCents > 0);

  // Fixed pricing - not configurable by brands
  const FIXED_PRIORITY_FEE = 500; // $5.00

  const isLoading = fetcher.state === 'submitting';

  // Show success/error messages
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message);
      
      if (fetcher.data.confirmationUrl) {
        // Redirect to Shopify for billing confirmation
        window.top?.location.assign(fetcher.data.confirmationUrl);
      }
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSaveSettings = useCallback(() => {
    const formData = new FormData();
    formData.append('action', 'updateSettings');
    formData.append('feeCents', FIXED_PRIORITY_FEE.toString()); // Always $5.00
    formData.append('slaHours', slaHours);
    formData.append('billingCapCents', billingCapCents);
    formData.append('enabled', enabled.toString());
    
    fetcher.submit(formData, { method: 'POST' });
  }, [slaHours, billingCapCents, enabled, fetcher]);

  const handleUpdateBillingCap = useCallback(() => {
    const formData = new FormData();
    formData.append('action', 'updateBillingCap');
    formData.append('billingCapCents', billingCapCents);
    
    fetcher.submit(formData, { method: 'POST' });
  }, [billingCapCents, fetcher]);

  const handleTriggerBilling = useCallback(() => {
    const formData = new FormData();
    formData.append('action', 'triggerBilling');
    
    fetcher.submit(formData, { method: 'POST' });
  }, [fetcher]);

  // Format currency
  const formatCurrency = (cents: number) => 
    `$${(cents / 100).toFixed(2)}`;

  // Prepare usage table data
  const usageTableRows = recentUsage.map(usage => [
    usage.yyyymmdd.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    usage.count.toString(),
    formatCurrency(usage.amountCents),
  ]);

  const currentCap = subscription?.lineItems[0]?.plan?.pricingDetails?.cappedAmount?.amount;

  return (
    <Page>
      <TitleBar title="Priority Handling Settings" />
      
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Current Statistics */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Priority Order Statistics
                </Text>
                
                <InlineStack gap="400">
                  <div>
                    <Text as="p" variant="bodyMd" color="subdued">Today</Text>
                    <Text as="p" variant="headingLg">{stats.today.totalCount}</Text>
                    <Text as="p" variant="bodySm">{formatCurrency(stats.today.totalCount * shop.feeCents)}</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="bodyMd" color="subdued">This Week</Text>
                    <Text as="p" variant="headingLg">{stats.week.totalCount}</Text>
                    <Text as="p" variant="bodySm">{formatCurrency(stats.week.totalCount * shop.feeCents)}</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="bodyMd" color="subdued">This Month</Text>
                    <Text as="p" variant="headingLg">{stats.month.totalCount}</Text>
                    <Text as="p" variant="bodySm">{formatCurrency(stats.month.totalCount * shop.feeCents)}</Text>
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Enable/Disable Priority Handling */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Priority Handling Status
                </Text>
                
                <Checkbox
                  label="Enable Priority Handling"
                  checked={enabled}
                  onChange={setEnabled}
                  helpText={enabled ? "Priority handling is active and available to customers" : "Priority handling is disabled"}
                />

                {/* Current SLA Status */}
                <Banner tone={isCurrentlyAvailable ? "success" : "warning"}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>Current SLA Status</strong>
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {slaMessage}
                    </Text>
                    {isCurrentlyAvailable && (
                      <Text as="p" variant="bodySm" color="subdued">
                        Time until cutoff: {timeUntilCutoff}
                      </Text>
                    )}
                  </BlockStack>
                </Banner>

                {enabled && (
                  <Banner tone="critical">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        <strong>⚠️ Critical: 3PL/Fulfillment Team Requirements</strong>
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Before enabling Priority Handling, ensure your shipping team or 3PL can:
                      </Text>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">
                          • <strong>Monitor the "PRIORITY_SKIP_LINE" tag</strong> on all incoming orders
                        </Text>
                        <Text as="p" variant="bodySm">
                          • <strong>Pick and pack within 3 hours</strong> for orders placed before 8PM EST
                        </Text>
                        <Text as="p" variant="bodySm">
                          • <strong>Process next business day</strong> for orders placed after 8PM EST
                        </Text>
                        <Text as="p" variant="bodySm">
                          • <strong>Meet SLA commitments</strong> to avoid customer complaints and refunds
                        </Text>
                      </BlockStack>
                      <Text as="p" variant="bodySm" color="subdued">
                        Orders with priority handling will be automatically tagged "PRIORITY_SKIP_LINE" and must be processed according to the time-based SLA above.
                      </Text>
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Priority Handling Information */}
            {enabled && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Priority Handling Configuration
                  </Text>
                  
                  <FormLayout>
                    {/* Fixed Pricing Display */}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        Pricing (Fixed)
                      </Text>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">Priority Handling Fee</Text>
                        <Badge tone="info" size="large">$5.00</Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" color="subdued">
                        This fee is fixed and cannot be changed. Customers pay $5.00 for priority handling.
                      </Text>
                    </BlockStack>

                    {/* SLA Information */}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        Service Level Agreement (SLA)
                      </Text>
                      <Banner tone={isCurrentlyAvailable ? "success" : "warning"}>
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd">
                            <strong>Current SLA:</strong> {slaInfo.message}
                          </Text>
                          <Text as="p" variant="bodySm">
                            • <strong>Before 8PM EST:</strong> 3-hour pick & pack guarantee
                          </Text>
                          <Text as="p" variant="bodySm">
                            • <strong>After 8PM EST:</strong> Next business day processing
                          </Text>
                          {isCurrentlyAvailable && (
                            <Text as="p" variant="bodySm" color="success">
                              ⏰ {timeUntilCutoff}
                            </Text>
                          )}
                        </BlockStack>
                      </Banner>
                    </BlockStack>

                    {/* Order Tagging Information */}
                    <Banner tone="info">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodyMd">
                          <strong>Order Tagging System</strong>
                        </Text>
                        <Text as="p" variant="bodySm">
                          All priority orders are tagged with: <Badge tone="info">PRIORITY_SKIP_LINE</Badge>
                        </Text>
                        <Text as="p" variant="bodySm">
                          Your fulfillment team must monitor this tag and prioritize these orders according to the SLA above.
                        </Text>
                      </BlockStack>
                    </Banner>

                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={handleSaveSettings}
                        loading={isLoading && fetcher.formData?.get('action') === 'updateSettings'}
                      >
                        Save Settings
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </BlockStack>
              </Card>
            )}

            {/* Billing Configuration */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Billing Configuration
                </Text>
                
                {subscription && (
                  <Banner>
                    <Text>
                      Current monthly cap: {formatCurrency(parseInt(currentCap || '0') * 100)}
                    </Text>
                  </Banner>
                )}
                
                <FormLayout>
                  <TextField
                    label="Monthly Billing Cap (cents)"
                    type="number"
                    value={billingCapCents}
                    onChange={setBillingCapCents}
                    helpText="Maximum amount that can be charged per month"
                    min="1000"
                  />

                  <InlineStack gap="200">
                    <Button
                      onClick={handleUpdateBillingCap}
                      loading={isLoading && fetcher.formData?.get('action') === 'updateBillingCap'}
                    >
                      Update Billing Cap
                    </Button>
                  </InlineStack>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Recent Usage */}
            {recentUsage.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Recent Usage (Last 7 Days)
                  </Text>
                  
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric']}
                    headings={['Date', 'Orders', 'Amount']}
                    rows={usageTableRows}
                  />
                </BlockStack>
              </Card>
            )}

            {/* 3PL Integration Guide */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  3PL / Fulfillment Team Integration
                </Text>
                
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>Setup Required for Your Fulfillment Team</strong>
                    </Text>
                    <Text as="p" variant="bodyMd">
                      To ensure priority orders are processed correctly, your fulfillment team or 3PL must:
                    </Text>
                  </BlockStack>
                </Banner>

                <BlockStack gap="300">
                  <InlineStack gap="300" align="start">
                    <Box>
                      <Badge tone="critical">Required</Badge>
                    </Box>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">
                        <strong>Monitor Order Tags</strong>
                      </Text>
                      <Text as="p" variant="bodySm" color="subdued">
                        All priority orders will have the tag: <Badge tone="info">PRIORITY_SKIP_LINE</Badge>
                      </Text>
                      <Text as="p" variant="bodySm" color="subdued">
                        Your team must check for this tag and prioritize these orders in their fulfillment queue.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineStack gap="300" align="start">
                    <Box>
                      <Badge tone="critical">Required</Badge>
                    </Box>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">
                        <strong>Meet SLA Commitments</strong>
                      </Text>
                      <Text as="p" variant="bodySm" color="subdued">
                        Priority orders must be processed within {slaHours} hours as promised to customers.
                      </Text>
                      <Text as="p" variant="bodySm" color="subdued">
                        Failure to meet SLA may result in customer complaints and refund requests.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineStack gap="300" align="start">
                    <Box>
                      <Badge tone="info">Helpful</Badge>
                    </Box>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">
                        <strong>Order Timeline Notes</strong>
                      </Text>
                      <Text as="p" variant="bodySm" color="subdued">
                        Priority orders also include timeline notes with SLA information for reference.
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>

                <Button 
                  onClick={() => window.open(`https://admin.shopify.com/store/${shop.domain.replace('.myshopify.com', '')}/orders?query=tag:PRIORITY_SKIP_LINE`, '_blank')}
                >
                  View All Priority Orders
                </Button>
              </BlockStack>
            </Card>

            {/* System Status */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  System Status
                </Text>
                
                <InlineStack gap="200" align="space-between">
                  <div>
                    <Text as="p" variant="bodyMd">Nightly Billing Job</Text>
                    <Badge tone={cronStatus.status === 'success' ? 'success' : 'critical'}>
                      {cronStatus.status}
                    </Badge>
                    {cronStatus.lastRun && (
                      <Text as="p" variant="bodySm" color="subdued">
                        Last run: {new Date(cronStatus.lastRun).toLocaleString()}
                      </Text>
                    )}
                    {cronStatus.message && (
                      <Text as="p" variant="bodySm" color="subdued">
                        {cronStatus.message}
                      </Text>
                    )}
                  </div>
                  
                  <Button
                    onClick={handleTriggerBilling}
                    loading={isLoading && fetcher.formData?.get('action') === 'triggerBilling'}
                  >
                    Trigger Manual Billing
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
