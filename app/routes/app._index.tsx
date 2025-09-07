import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { getPriorityOrderStats } from "~/services/priority";
import { checkShopNeedsSetup } from "~/services/setup";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get or create shop data first
  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        id: `shop_${session.shop.replace('.myshopify.com', '')}`,
        domain: session.shop,
        accessToken: session.accessToken,
        currency: 'USD',
        timezone: 'America/New_York',
        billingCapCents: 50000,
        feeCents: 0, // Start disabled
        slaHours: 3,
      },
    });
  }

  // Check if shop needs setup
  let needsSetup = true;
  try {
    needsSetup = await checkShopNeedsSetup(prisma, session.shop, session.accessToken);
  } catch (error) {
    console.log('Could not check setup status:', error.message);
  }

  // Get priority order statistics
  const [todayStats, weekStats, monthStats] = await Promise.all([
    getPriorityOrderStats(prisma, shop.id, 1),
    getPriorityOrderStats(prisma, shop.id, 7),
    getPriorityOrderStats(prisma, shop.id, 30),
  ]);

  // Get recent priority orders
  const recentOrders = await prisma.orderMarker.findMany({
    where: {
      shopId: shop.id,
      priority: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const isEnabled = shop.feeCents > 0;

  return json({
    shop: {
      id: shop.id,
      domain: shop.domain,
      currency: shop.currency,
      feeCents: shop.feeCents,
      slaHours: shop.slaHours,
    },
    stats: {
      today: todayStats,
      week: weekStats,
      month: monthStats,
    },
    recentOrders,
    isEnabled,
    needsSetup,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'setup') {
    const { setupNewShop } = await import('~/services/setup');
    const result = await setupNewShop(prisma, session.shop, session.accessToken);
    return json(result);
  }

  return json({ success: false });
};

export default function Index() {
  const { shop, stats, recentOrders, isEnabled, needsSetup } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const todayRevenue = stats.today.totalCount * shop.feeCents;
  const weekRevenue = stats.week.totalCount * shop.feeCents;
  const monthRevenue = stats.month.totalCount * shop.feeCents;

  const isSetupLoading = fetcher.state === 'submitting';

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show('Priority Handling setup completed! 🎉');
      window.location.reload();
    } else if (fetcher.data?.errors) {
      shopify.toast.show(`Setup error: ${fetcher.data.errors[0]}`, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSetup = () => {
    const formData = new FormData();
    formData.append('action', 'setup');
    fetcher.submit(formData, { method: 'POST' });
  };

  return (
    <Page>
      <TitleBar title="Priority Handling Dashboard" />
      <BlockStack gap="500">
        
        {/* Setup Banner */}
        {needsSetup && (
          <Banner tone="warning">
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">
                <strong>🚀 Welcome to Priority Handling!</strong> Let's set up your store automatically.
              </Text>
              <Text as="p" variant="bodySm">
                This will create a $5.00 Priority Handling Fee product and configure everything.
              </Text>
              <Button 
                onClick={handleSetup} 
                variant="primary" 
                loading={isSetupLoading}
                size="large"
              >
                {isSetupLoading ? 'Setting Up...' : 'Set Up Priority Handling'}
              </Button>
            </BlockStack>
          </Banner>
        )}

        {/* Main Controls */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">
                  Priority Handling
                </Text>
                <Text as="p" variant="bodyMd" color="subdued">
                  Let customers pay $5 to skip the line and get 3-hour processing
                </Text>
              </BlockStack>
              
              <InlineStack gap="300" blockAlign="center">
                <Badge tone={isEnabled ? "success" : "critical"} size="large">
                  {isEnabled ? "ENABLED" : "DISABLED"}
                </Badge>
                <Link to="/app/toggle" style={{ textDecoration: 'none' }}>
                  <Button variant="primary" size="large">
                    {isEnabled ? "Turn Off" : "Turn On"}
                  </Button>
                </Link>
              </InlineStack>
            </InlineStack>

            {isEnabled && (
              <Banner tone="info">
                <Text as="p" variant="bodyMd">
                  ✅ Customers can now purchase priority handling for $5.00. Orders will be tagged <Badge tone="info">PRIORITY_SKIP_LINE</Badge> for your fulfillment team.
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Statistics */}
        {!needsSetup && (
          <Layout>
            <Layout.Section oneThird>
              <Card>
                <BlockStack gap="200" align="center">
                  <Text as="h3" variant="headingMd" color="subdued">Today</Text>
                  <Text as="p" variant="heading2xl">{stats.today.totalCount}</Text>
                  <Text as="p" variant="bodyMd">{formatCurrency(todayRevenue)}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section oneThird>
              <Card>
                <BlockStack gap="200" align="center">
                  <Text as="h3" variant="headingMd" color="subdued">This Week</Text>
                  <Text as="p" variant="heading2xl">{stats.week.totalCount}</Text>
                  <Text as="p" variant="bodyMd">{formatCurrency(weekRevenue)}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section oneThird>
              <Card>
                <BlockStack gap="200" align="center">
                  <Text as="h3" variant="headingMd" color="subdued">This Month</Text>
                  <Text as="p" variant="heading2xl">{stats.month.totalCount}</Text>
                  <Text as="p" variant="bodyMd">{formatCurrency(monthRevenue)}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        {/* Recent Orders */}
        {!needsSetup && recentOrders.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Recent Priority Orders</Text>
              <DataTable
                columnContentTypes={['text', 'text', 'text']}
                headings={['Order', 'Date', 'Status']}
                rows={recentOrders.map(order => [
                  order.orderGid.replace('gid://shopify/Order/', '#'),
                  new Date(order.createdAt).toLocaleDateString(),
                  'Priority'
                ])}
              />
            </BlockStack>
          </Card>
        )}

        {/* Quick Actions */}
        {!needsSetup && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Quick Actions</Text>
              <InlineStack gap="300">
                <Link to="/app/toggle" style={{ textDecoration: 'none' }}>
                  <Button variant="primary">
                    {isEnabled ? "Turn Off" : "Turn On"}
                  </Button>
                </Link>
                <Button 
                  onClick={() => window.open(`https://admin.shopify.com/store/${shop.domain.replace('.myshopify.com', '')}/orders?query=tag:PRIORITY_SKIP_LINE`, '_blank')}
                >
                  View Priority Orders
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

      </BlockStack>
    </Page>
  );
}
