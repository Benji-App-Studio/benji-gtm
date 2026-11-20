import { SocialPosts } from "@/components/social-posts";

/** Research › Social posts: the analyses of organic posts (competitors, one account, a brand campaign) for this app. */
export default async function SocialPostsPage({ params }: PageProps<"/app/w/[productId]/research/social">) {
  const { productId } = await params;
  return <SocialPosts productId={productId} />;
}
